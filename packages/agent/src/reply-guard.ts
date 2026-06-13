import type { TranscriptEntry } from "./transcript.js";

const lastReplyAt = new Map<string, number>();

const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_SELF_TALK_TAIL = 4;

export function recordAutoReply(chatId: string): void {
  lastReplyAt.set(chatId, Date.now());
}

export function replyCooldownMs(
  styleCooldown: number | undefined,
): number {
  if (styleCooldown !== undefined && styleCooldown >= 0) {
    return styleCooldown;
  }
  const env = process.env.WECHAT_REPLY_COOLDOWN_MS?.trim();
  if (env) {
    const n = Number(env);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return DEFAULT_COOLDOWN_MS;
}

export function isReplyCoolingDown(
  chatId: string,
  cooldownMs: number,
): boolean {
  if (cooldownMs <= 0) return false;
  const last = lastReplyAt.get(chatId);
  if (last === undefined) return false;
  return Date.now() - last < cooldownMs;
}

/** transcript 尾部连续 assistant 条数过多时跳过（防自说自话循环）。 */
export function shouldSkipSelfTalk(
  entries: TranscriptEntry[],
  tailCount = DEFAULT_SELF_TALK_TAIL,
): boolean {
  if (entries.length < tailCount) return false;
  const tail = entries.slice(-tailCount);
  return tail.every((e) => e.role === "assistant");
}

export type ReplySkipReason = "cooling_down" | "self_talk";

export function evaluateReplySkip(params: {
  chatId: string;
  cooldownMs: number;
  transcriptEntries: TranscriptEntry[];
  wasMentioned: boolean;
}): ReplySkipReason | undefined {
  if (params.wasMentioned) return undefined;

  if (isReplyCoolingDown(params.chatId, params.cooldownMs)) {
    return "cooling_down";
  }

  if (shouldSkipSelfTalk(params.transcriptEntries)) {
    return "self_talk";
  }

  return undefined;
}
