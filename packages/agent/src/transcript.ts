import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@cococat/shared";
import { readCaption } from "./wiki-registry.js";

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  localId?: number;
};

const WECHAT_TYPE_IMAGE = 3;
const WECHAT_TYPE_VOICE = 34;
const WECHAT_TYPE_VIDEO = 43;
const WECHAT_TYPE_EMOJI = 47;

function messageLine(
  msg: Message,
  isGroup: boolean,
  captionsDir: string,
): string {
  const baseType = msg.type & 0x7fffffff;

  if (baseType === WECHAT_TYPE_IMAGE || msg.mediaKind === "image") {
    const cap = readCaption(captionsDir, msg.localId);
    if (cap) return `（发了一张图：${cap}）`;
    return "（发了一张图）";
  }
  if (baseType === WECHAT_TYPE_VOICE || msg.mediaKind === "voice") {
    const cap = readCaption(captionsDir, msg.localId);
    if (cap) return `（发了一条语音：${cap}）`;
    return "（发了一条语音）";
  }
  if (baseType === WECHAT_TYPE_VIDEO || msg.mediaKind === "video") {
    const cap = readCaption(captionsDir, msg.localId);
    if (cap) return `（发了一个视频：${cap}）`;
    return "（发了一个视频）";
  }
  if (baseType === WECHAT_TYPE_EMOJI || msg.mediaKind === "emoji") {
    const cap = readCaption(captionsDir, msg.localId);
    if (cap) return `（发了一个表情：${cap}）`;
    return "（发了一个表情）";
  }

  const text = msg.content?.trim() ?? "";
  if (msg.isSelf) return text;
  if (isGroup) {
    const name = msg.senderName ?? msg.sender ?? "unknown";
    return `${name}: ${text}`;
  }
  return text;
}

export function loadTranscript(path: string): TranscriptEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is TranscriptEntry =>
        typeof e === "object" &&
        e !== null &&
        (e as TranscriptEntry).role !== undefined &&
        typeof (e as TranscriptEntry).text === "string",
    );
  } catch (err) {
    console.warn(
      `[pi-wechat] failed to load transcript ${path}; context will be empty:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export function saveTranscript(path: string, entries: TranscriptEntry[]): void {
  writeFileSync(path, JSON.stringify(entries, null, 0), "utf8");
}

export function dbMessagesToTranscript(
  messages: Message[],
  isGroup: boolean,
  captionsDir: string,
  limit: number,
): TranscriptEntry[] {
  const slice = messages.slice(-limit);
  const entries: TranscriptEntry[] = [];
  for (const msg of slice) {
    const text = messageLine(msg, isGroup, captionsDir);
    if (!text && !msg.isSelf) continue;
    entries.push({
      role: msg.isSelf ? "assistant" : "user",
      text: msg.isSelf ? text : isGroup ? text : text,
      localId: msg.localId,
    });
  }
  return entries;
}

const MEDIA_TEXT_MARKERS = [
  "发了一条语音",
  "发了一张图",
  "发了一个视频",
  "发了一个表情",
];

function entryLooksLikeMedia(entry: TranscriptEntry): boolean {
  return MEDIA_TEXT_MARKERS.some((m) => entry.text.includes(m));
}

/** 尾部 N 条带 localId 的媒体行：比对 caption 文件，兜底 patch（不扫全量 mtime）。 */
export function patchTranscriptTailMediaCaptions(
  entries: TranscriptEntry[],
  captionsDir: string,
  isGroup: boolean,
  tailWindow = 10,
): TranscriptEntry[] {
  if (entries.length === 0 || tailWindow <= 0) return entries;

  const indices: number[] = [];
  for (let i = entries.length - 1; i >= 0 && indices.length < tailWindow; i--) {
    const e = entries[i]!;
    if (e.localId !== undefined && entryLooksLikeMedia(e)) {
      indices.push(i);
    }
  }
  if (indices.length === 0) return entries;

  let changed = false;
  const next = [...entries];
  for (const idx of indices) {
    const entry = next[idx]!;
    const localId = entry.localId!;
    const patched = patchEntryCaption(entry, localId, captionsDir, isGroup);
    if (patched && patched.text !== entry.text) {
      next[idx] = patched;
      changed = true;
    }
  }
  return changed ? next : entries;
}

/** localId 带标注的条目是否乱序（非单调递增）。 */
export function transcriptLocalIdsOutOfOrder(
  entries: TranscriptEntry[],
): boolean {
  const ids = entries
    .map((e) => e.localId)
    .filter((id): id is number => id !== undefined);
  for (let i = 1; i < ids.length; i++) {
    if (ids[i]! < ids[i - 1]!) return true;
  }
  return false;
}

function patchEntryCaption(
  entry: TranscriptEntry,
  localId: number,
  captionsDir: string,
  isGroup: boolean,
): TranscriptEntry | undefined {
  if (entry.localId !== localId) return undefined;
  const cap = readCaption(captionsDir, localId);
  if (!cap) return undefined;

  if (entry.text.includes("发了一条语音")) {
    const body = `（发了一条语音：${cap}）`;
    const prefix = isGroup && entry.text.includes(": ")
      ? entry.text.slice(0, entry.text.indexOf(": ") + 2)
      : "";
    return { ...entry, text: prefix ? `${prefix}${body}` : body };
  }
  if (entry.text.includes("发了一张图")) {
    const body = `（发了一张图：${cap}）`;
    const prefix = isGroup && entry.text.includes(": ")
      ? entry.text.slice(0, entry.text.indexOf(": ") + 2)
      : "";
    return { ...entry, text: prefix ? `${prefix}${body}` : body };
  }
  if (entry.text.includes("发了一个视频")) {
    const body = `（发了一个视频：${cap}）`;
    const prefix = isGroup && entry.text.includes(": ")
      ? entry.text.slice(0, entry.text.indexOf(": ") + 2)
      : "";
    return { ...entry, text: prefix ? `${prefix}${body}` : body };
  }
  if (entry.text.includes("发了一个表情")) {
    const body = `（发了一个表情：${cap}）`;
    const prefix = isGroup && entry.text.includes(": ")
      ? entry.text.slice(0, entry.text.indexOf(": ") + 2)
      : "";
    return { ...entry, text: prefix ? `${prefix}${body}` : body };
  }
  return undefined;
}

/** 按 DirtyMap 局部更新 caption 文本，不扫盘 mtime。 */
export function patchTranscriptCaptions(
  entries: TranscriptEntry[],
  dirtyLocalIds: number[],
  captionsDir: string,
  isGroup: boolean,
): TranscriptEntry[] {
  if (dirtyLocalIds.length === 0) return entries;
  const dirty = new Set(dirtyLocalIds);
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.localId === undefined || !dirty.has(entry.localId)) {
      return entry;
    }
    const patched = patchEntryCaption(
      entry,
      entry.localId,
      captionsDir,
      isGroup,
    );
    if (patched) {
      changed = true;
      return patched;
    }
    return entry;
  });
  return changed ? next : entries;
}

export function transcriptNeedsRebuild(
  metaLastLocalId: number | undefined,
  dbMessages: Message[],
  entries: TranscriptEntry[] = [],
): boolean {
  if (metaLastLocalId === undefined) return true;
  const maxId = dbMessages.reduce(
    (max, m) => (m.localId > max ? m.localId : max),
    0,
  );
  if (maxId < metaLastLocalId) return true;
  if (transcriptLocalIdsOutOfOrder(entries)) return true;
  return false;
}

export function transcriptToContextBlock(entries: TranscriptEntry[]): AgentMessage | undefined {
  if (entries.length === 0) return undefined;
  const lines = entries.map((e) =>
    e.role === "assistant" ? `我: ${e.text}` : e.text,
  );
  return {
    role: "user",
    content: `【近期对话】\n${lines.join("\n")}`,
    timestamp: Date.now() - 1000,
  };
}

export function appendTurnToTranscript(
  path: string,
  existing: TranscriptEntry[],
  userLines: string[],
  assistantLines: string[],
  limit: number,
  userLocalIds?: number[],
): TranscriptEntry[] {
  const next = [...existing];
  if (userLines.length > 0) {
    const entry: TranscriptEntry = {
      role: "user",
      text: userLines.join("\n"),
    };
    if (userLocalIds && userLocalIds.length > 0) {
      entry.localId = Math.max(...userLocalIds);
    }
    next.push(entry);
  }
  for (const line of assistantLines) {
    if (line.trim()) next.push({ role: "assistant", text: line.trim() });
  }
  const trimmed = next.slice(-limit * 2);
  saveTranscript(path, trimmed);
  return trimmed;
}
