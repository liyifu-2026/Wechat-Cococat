import { resolveReplyCooldownMs } from "./effective-config.js";

const lastReplyAt = new Map<string, number>();

const MAX_REPLY_TRACKED_CHATS = 1_000;
const REPLY_TRACK_TTL_MS = 24 * 60 * 60 * 1000;

function sweepReplyMap(now = Date.now()): void {
  for (const [chatId, ts] of lastReplyAt) {
    if (now - ts > REPLY_TRACK_TTL_MS) {
      lastReplyAt.delete(chatId);
    }
  }
  while (lastReplyAt.size > MAX_REPLY_TRACKED_CHATS) {
    const oldest = lastReplyAt.keys().next().value as string | undefined;
    if (!oldest) break;
    lastReplyAt.delete(oldest);
  }
}

export function recordAutoReply(chatId: string): void {
  sweepReplyMap();
  lastReplyAt.set(chatId, Date.now());
}

export function replyCooldownMs(
  styleCooldown: number | undefined,
): number {
  return resolveReplyCooldownMs({ styleCooldownMs: styleCooldown });
}

export function isReplyCoolingDown(
  chatId: string,
  cooldownMs: number,
): boolean {
  if (cooldownMs <= 0) return false;
  sweepReplyMap();
  const last = lastReplyAt.get(chatId);
  if (last === undefined) return false;
  return Date.now() - last < cooldownMs;
}

export type ReplySkipReason = "cooling_down";

export function evaluateReplySkip(params: {
  chatId: string;
  cooldownMs: number;
  wasMentioned: boolean;
}): ReplySkipReason | undefined {
  if (params.wasMentioned) return undefined;

  if (isReplyCoolingDown(params.chatId, params.cooldownMs)) {
    return "cooling_down";
  }

  return undefined;
}
