import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCococatDataRoot } from "@cococat/shared";
import { chatDirPath } from "../paths.js";
import type {
  ChatEscalationState,
  MaintainerPending,
  MuteEntry,
  MuteReason,
} from "./types.js";

const MUTES_FILE = "mutes.json";
const MAINTAINER_SESSION_FILE = "maintainer-session.json";

function escalationDir(): string {
  return join(getCococatDataRoot(), "escalation");
}

function mutesPath(): string {
  return join(escalationDir(), MUTES_FILE);
}

function maintainerSessionPath(): string {
  return join(escalationDir(), MAINTAINER_SESSION_FILE);
}

function ensureEscalationDir(): void {
  mkdirSync(escalationDir(), { recursive: true });
}

const DEFAULT_CHAT_STATE: ChatEscalationState = {
  deflectSent: false,
  probeStreak: 0,
};

function chatStatePath(chatId: string): string {
  return join(chatDirPath(chatId), "escalation-state.json");
}

export function loadChatEscalationState(chatId: string): ChatEscalationState {
  const path = chatStatePath(chatId);
  if (!existsSync(path)) return { ...DEFAULT_CHAT_STATE };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ChatEscalationState;
    return {
      deflectSent: Boolean(raw.deflectSent),
      probeStreak:
        typeof raw.probeStreak === "number" && raw.probeStreak >= 0
          ? raw.probeStreak
          : 0,
    };
  } catch (err) {
    console.warn(
      `[pi-wechat] failed to load escalation state for ${chatId}; using defaults:`,
      err instanceof Error ? err.message : err,
    );
    return { ...DEFAULT_CHAT_STATE };
  }
}

export function saveChatEscalationState(
  chatId: string,
  state: ChatEscalationState,
): void {
  const dir = chatDirPath(chatId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    chatStatePath(chatId),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
}

type MuteFile = {
  entries: MuteEntry[];
};

function loadMutes(): MuteEntry[] {
  ensureEscalationDir();
  const path = mutesPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as MuteFile;
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch (err) {
    console.warn(
      "[pi-wechat] failed to load mutes.json; active mutes ignored:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

function saveMutes(entries: MuteEntry[]): void {
  ensureEscalationDir();
  const now = Date.now();
  const active = entries.filter((e) => e.mutedUntil > now);
  writeFileSync(
    mutesPath(),
    JSON.stringify({ entries: active }, null, 2) + "\n",
    "utf8",
  );
}

export function listActiveMutes(): MuteEntry[] {
  const active = loadMutes().filter((e) => e.mutedUntil > Date.now());
  if (active.length !== loadMutes().length) {
    saveMutes(active);
  }
  return active;
}

export function isChatMuted(chatId: string): boolean {
  const entry = listActiveMutes().find((e) => e.chatId === chatId);
  return Boolean(entry);
}

export function muteChat(
  chatId: string,
  chatName: string,
  reason: MuteReason,
  hours: number,
  opts?: { lastUserLine?: string },
): MuteEntry {
  const entries = listActiveMutes().filter((e) => e.chatId !== chatId);
  const lastUserLine = opts?.lastUserLine?.trim();
  const entry: MuteEntry = {
    chatId,
    chatName,
    reason,
    mutedUntil: Date.now() + hours * 60 * 60 * 1000,
    triggeredAt: new Date().toISOString(),
    ...(lastUserLine ? { lastUserLine } : {}),
  };
  entries.push(entry);
  saveMutes(entries);
  return entry;
}

export function unmuteChat(chatId: string): boolean {
  const entries = listActiveMutes();
  const next = entries.filter((e) => e.chatId !== chatId);
  if (next.length === entries.length) return false;
  saveMutes(next);
  return true;
}

const MEMORY_PICK_TTL_MS = 10 * 60 * 1000;

export function maintainerMemoryPickTtlMs(): number {
  return MEMORY_PICK_TTL_MS;
}

function isExpiredMemoryPick(pending: MaintainerPending): boolean {
  return (
    pending.action === "pick_memory" &&
    typeof pending.expiresAt === "number" &&
    pending.expiresAt <= Date.now()
  );
}

export function loadMaintainerPending(): MaintainerPending | null {
  ensureEscalationDir();
  const path = maintainerSessionPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(
      readFileSync(path, "utf8"),
    ) as MaintainerPending;
    if (raw.action === "pick_unmute" && Array.isArray(raw.candidates)) {
      return raw;
    }
    if (
      raw.action === "pick_memory" &&
      Array.isArray(raw.candidates) &&
      typeof raw.expiresAt === "number"
    ) {
      if (isExpiredMemoryPick(raw)) {
        saveMaintainerPending(null);
        return null;
      }
      return raw;
    }
  } catch (err) {
    console.warn(
      "[pi-wechat] failed to load maintainer pending state:",
      err instanceof Error ? err.message : err,
    );
  }
  return null;
}

export function saveMaintainerPending(pending: MaintainerPending | null): void {
  ensureEscalationDir();
  const path = maintainerSessionPath();
  if (!pending) {
    if (existsSync(path)) {
      writeFileSync(path, "{}\n", "utf8");
    }
    return;
  }
  writeFileSync(
    path,
    JSON.stringify(pending, null, 2) + "\n",
    "utf8",
  );
}
