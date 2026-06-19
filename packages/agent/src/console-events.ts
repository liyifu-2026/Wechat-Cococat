import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.js";

export type ConsoleEventKind =
  | "low_confidence"
  | "no_wiki_hit"
  | "escalate_a"
  | "probe_b"
  | "agent_handoff"
  | "auto_reply"
  | "agent_trace"
  | "ops_memory_peek";

export type ConsoleEvent = {
  ts: string;
  kind: ConsoleEventKind;
  chatId?: string;
  chatName?: string;
  /** 同一轮回复的步骤共享此 id，便于 Console 分组展示 */
  turnId?: string;
  topic?: string;
  query?: string;
  confidence?: number;
  reason?: string;
};

function eventsPath(): string {
  return join(dataDir(), "events.jsonl");
}
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_LINES = 1_000;

function trimEventsFile(): void {
  try {
    const path = eventsPath();
    const size = statSync(path).size;
    if (size <= MAX_FILE_BYTES) return;
    const raw = readFileSync(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const tail = lines.slice(-MAX_EVENT_LINES);
    writeFileSync(path, `${tail.join("\n")}\n`, "utf8");
  } catch (err) {
    console.warn(
      "[pi-wechat] trim events file failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function appendConsoleEvent(
  event: Omit<ConsoleEvent, "ts"> & { ts?: string },
): void {
  const line: ConsoleEvent = {
    ts: event.ts ?? new Date().toISOString(),
    kind: event.kind,
    chatId: event.chatId,
    chatName: event.chatName,
    turnId: event.turnId,
    topic: event.topic,
    query: event.query,
    confidence: event.confidence,
    reason: event.reason,
  };
  try {
    const path = eventsPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
    trimEventsFile();
  } catch (err) {
    console.warn("[pi-wechat] appendConsoleEvent failed:", err);
  }
}

export function eventsFilePath(): string {
  return eventsPath();
}
