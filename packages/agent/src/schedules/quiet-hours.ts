import type { QuietHours } from "./types.js";

function parseHm(value: string): number | undefined {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return h * 60 + min;
}

/** 当前是否处于静默时段（默认 Asia/Shanghai 本地钟面）。 */
export function isQuietHoursNow(quiet?: QuietHours): boolean {
  if (!quiet?.start || !quiet?.end) return false;
  const start = parseHm(quiet.start);
  const end = parseHm(quiet.end);
  if (start === undefined || end === undefined) return false;

  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();

  if (start === end) return false;
  if (start < end) {
    return cur >= start && cur < end;
  }
  return cur >= start || cur < end;
}

export function isOutboundChatAllowed(
  chatId: string,
  allowlist?: string[],
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.includes(chatId);
}
