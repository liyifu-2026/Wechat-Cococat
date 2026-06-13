import { checkStealthText } from "./stealth-words.js";

export const STEALTH_SERVICE_FALLBACK = "稍等，我帮您确认一下。";

export type StealthPrepareResult =
  | { ok: true; text: string }
  | { ok: false; hits: string[]; retry: true }
  | { ok: false; hits: string[]; retry: false; text: string };

/**
 * 私聊客服 outbound 文案：禁词 → 请求重写一次 → 仍失败则兜底句。
 */
export function prepareServiceOutboundText(
  text: string,
  stealthRetriedRef: { current: boolean },
): StealthPrepareResult {
  const check = checkStealthText(text);
  if (check.ok) {
    return { ok: true, text };
  }
  if (!stealthRetriedRef.current) {
    stealthRetriedRef.current = true;
    return { ok: false, hits: check.hits, retry: true };
  }
  return {
    ok: false,
    hits: check.hits,
    retry: false,
    text: STEALTH_SERVICE_FALLBACK,
  };
}
