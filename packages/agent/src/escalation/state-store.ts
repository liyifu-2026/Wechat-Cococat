import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatDirPath, DATA_DIR } from "../paths.js";
import type {
  ChatEscalationState,
  MaintainerPending,
  MuteEntry,
  MuteReason,
} from "./types.js";

const ESCALATION_DIR = join(DATA_DIR, "escalation");
const MUTES_PATH = join(ESCALATION_DIR, "mutes.json");
const MAINTAINER_SESSION_PATH = join(ESCALATION_DIR, "maintainer-session.json");

const DEFAULT_CHAT_STATE: ChatEscalationState = {
  deflectSent: false,
  probeStreak: 0,
};

function ensureEscalationDir(): void {
  mkdirSync(ESCALATION_DIR, { recursive: true });
}

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
  } catch {
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
  if (!existsSync(MUTES_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(MUTES_PATH, "utf8")) as MuteFile;
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

function saveMutes(entries: MuteEntry[]): void {
  ensureEscalationDir();
  const now = Date.now();
  const active = entries.filter((e) => e.mutedUntil > now);
  writeFileSync(
    MUTES_PATH,
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
): MuteEntry {
  const entries = listActiveMutes().filter((e) => e.chatId !== chatId);
  const entry: MuteEntry = {
    chatId,
    chatName,
    reason,
    mutedUntil: Date.now() + hours * 60 * 60 * 1000,
    triggeredAt: new Date().toISOString(),
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

export function loadMaintainerPending(): MaintainerPending | null {
  ensureEscalationDir();
  if (!existsSync(MAINTAINER_SESSION_PATH)) return null;
  try {
    const raw = JSON.parse(
      readFileSync(MAINTAINER_SESSION_PATH, "utf8"),
    ) as MaintainerPending;
    if (raw.action === "pick_unmute" && Array.isArray(raw.candidates)) {
      return raw;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveMaintainerPending(pending: MaintainerPending | null): void {
  ensureEscalationDir();
  if (!pending) {
    if (existsSync(MAINTAINER_SESSION_PATH)) {
      writeFileSync(MAINTAINER_SESSION_PATH, "{}\n", "utf8");
    }
    return;
  }
  writeFileSync(
    MAINTAINER_SESSION_PATH,
    JSON.stringify(pending, null, 2) + "\n",
    "utf8",
  );
}
