import type { Chat, WeChatClient } from "@cococat/shared";
import { appendConsoleEvent } from "../console-events.js";
import { ensureChatContext } from "../chat-store.js";
import { loadChatProfile } from "../chat-profile.js";
import { listActiveMutes } from "../escalation/state-store.js";
import type { MemoryCandidate } from "../escalation/types.js";
import type { MemoryClient } from "../memory-client.js";
import { readChatPersonaRaw } from "../persona.js";
import { listKnownChatIds } from "../reconcile-transcript.js";
import { loadTranscript } from "../transcript.js";
import { clampOpsReply } from "./wiki-sniff.js";

export const MEMORY_PICK_MAX = 5;
export const MEMORY_OPS_RECALL_MAX_LINES = 24;

export type ResolveMemoryTargetResult =
  | { kind: "error"; message: string }
  | { kind: "single"; candidate: MemoryCandidate }
  | { kind: "pick"; query: string; candidates: MemoryCandidate[] }
  | { kind: "too_many"; count: number };

export function parseMaintainerMemoryCommand(body: string): string | null {
  const text = body.trim();
  const m = text.match(/^记忆\s+(.+)$/su);
  return m?.[1]?.trim() ?? null;
}

export function isChatIdQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/^wxid_/iu.test(q)) return true;
  if (/@chatroom$/iu.test(q)) return true;
  return false;
}

function chatDisplayName(chat: Chat): string {
  return chat.remark?.trim() || chat.name?.trim() || chat.id;
}

function loadProfileTags(chatId: string): string[] {
  return loadChatProfile(chatId).tags;
}

function lastUserLine(chatId: string): string | undefined {
  const ctx = ensureChatContext(chatId);
  const entries = loadTranscript(ctx.transcriptPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.role === "user" && e.text.trim()) {
      const line = e.text.trim();
      return line.length > 40 ? `${line.slice(0, 40)}…` : line;
    }
  }
  return undefined;
}

function chatRecencyScore(chatId: string): number {
  const ctx = ensureChatContext(chatId);
  if (typeof ctx.meta.lastLocalId === "number") return ctx.meta.lastLocalId;
  const entries = loadTranscript(ctx.transcriptPath);
  const last = entries.at(-1);
  return last?.localId ?? 0;
}

function formatMuteLabel(chatId: string): string {
  const mute = listActiveMutes().find((m) => m.chatId === chatId);
  if (!mute) return "自动回复中";
  const leftMs = mute.mutedUntil - Date.now();
  const leftH = Math.max(0, Math.ceil(leftMs / (60 * 60 * 1000)));
  const tag = mute.reason === "escalate_a" ? "转人工" : "试探升级";
  return `${tag} · mute 剩 ${leftH}h`;
}

export function buildMemoryCandidate(
  chat: Chat,
): MemoryCandidate {
  const chatName = chatDisplayName(chat);
  return {
    chatId: chat.id,
    chatName,
    muteLabel: formatMuteLabel(chat.id),
    profileTags: loadProfileTags(chat.id),
    lastUserLine: lastUserLine(chat.id),
  };
}

function sortMemoryCandidates(
  query: string,
  candidates: MemoryCandidate[],
): MemoryCandidate[] {
  const q = query.trim().toLowerCase();
  return [...candidates].sort((a, b) => {
    const aExact = a.chatName.toLowerCase() === q ? 1 : 0;
    const bExact = b.chatName.toLowerCase() === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return chatRecencyScore(b.chatId) - chatRecencyScore(a.chatId);
  });
}

function filterToAgentChats(chats: Chat[]): Chat[] {
  const known = new Set(listKnownChatIds());
  if (known.size === 0) return chats;
  return chats.filter((c) => known.has(c.id));
}

export async function resolveMemoryTarget(
  query: string,
  client: WeChatClient,
): Promise<ResolveMemoryTargetResult> {
  const q = query.trim();
  if (!q) {
    return { kind: "error", message: "请提供客户备注名或 chatId。" };
  }

  if (isChatIdQuery(q)) {
    const chat = await client.getChat(q);
    if (!chat) {
      return { kind: "error", message: `未找到 chatId：${q}` };
    }
    return { kind: "single", candidate: buildMemoryCandidate(chat) };
  }

  const found = filterToAgentChats(await client.findChats(q));
  if (found.length === 0) {
    return {
      kind: "error",
      message: "未找到，请用更全备注名或 chatId。",
    };
  }

  const candidates = sortMemoryCandidates(q, found.map(buildMemoryCandidate));
  if (candidates.length === 1) {
    return { kind: "single", candidate: candidates[0]! };
  }
  if (candidates.length > MEMORY_PICK_MAX) {
    return { kind: "too_many", count: candidates.length };
  }
  return { kind: "pick", query: q, candidates };
}

function formatCandidateLine(c: MemoryCandidate, index: number): string {
  const lines: string[] = [
    `${index}) ${c.chatName} · ${c.muteLabel}`,
  ];
  if (c.lastUserLine) {
    lines.push(`   最近：「${c.lastUserLine}」`);
  }
  if (c.profileTags.length > 0) {
    lines.push(`   标签：${c.profileTags.join(", ")}`);
  }
  const suffix = c.chatId.length > 4 ? c.chatId.slice(-4) : c.chatId;
  lines.push(`   chatId: …${suffix}`);
  return lines.join("\n");
}

export function formatMemoryPickList(
  query: string,
  candidates: MemoryCandidate[],
): string {
  const header = `⚠️ 匹配到 ${candidates.length} 个「${query}」：`;
  const body = candidates
    .map((c, i) => formatCandidateLine(c, i + 1))
    .join("\n");
  return clampOpsReply(
    `${header}\n${body}\n\n请回复序号、更完整备注名，或 chatId。`,
  );
}

function clipRecallLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MEMORY_OPS_RECALL_MAX_LINES) return text;
  return `${lines.slice(0, MEMORY_OPS_RECALL_MAX_LINES).join("\n")}\n(已截断)`;
}

export async function formatMemorySnapshot(
  candidate: MemoryCandidate,
  memoryClient: MemoryClient,
): Promise<string> {
  const ctx = ensureChatContext(candidate.chatId);
  const gateway = await memoryClient.recallForOps(candidate.chatId);
  const personaRaw = readChatPersonaRaw(ctx.personaPath);

  const blocks: string[] = [
    `【记忆 · ${candidate.chatName}】`,
    `chatId: ${candidate.chatId}`,
    "",
    "--- Gateway ---",
    gateway ? clipRecallLines(gateway) : "(无)",
    "",
    "--- persona.md ---",
    personaRaw || "(无)",
  ];

  appendConsoleEvent({
    kind: "ops_memory_peek",
    chatId: candidate.chatId,
    chatName: candidate.chatName,
  });

  return clampOpsReply(blocks.join("\n"));
}

export function maintainerMemoryHelpExtra(): string {
  return " / 记忆 <备注或chatId>";
}
