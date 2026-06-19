export const DEFAULT_POLL_FALLBACK_MS = 30_000;
export const MIN_POLL_FALLBACK_MS = 1_000;
export const DEFAULT_REPLY_COOLDOWN_MS = 30_000;

function parseNonNegativeNumber(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function resolvePollFallbackMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.WECHAT_PI_POLL_MS ?? DEFAULT_POLL_FALLBACK_MS);
  if (!Number.isFinite(raw)) return DEFAULT_POLL_FALLBACK_MS;
  return Math.max(MIN_POLL_FALLBACK_MS, raw);
}

export function resolveReplyCooldownMs(params: {
  styleCooldownMs?: number;
  env?: NodeJS.ProcessEnv;
}): number {
  if (
    params.styleCooldownMs !== undefined &&
    Number.isFinite(params.styleCooldownMs) &&
    params.styleCooldownMs >= 0
  ) {
    return params.styleCooldownMs;
  }
  return (
    parseNonNegativeNumber(
      (params.env ?? process.env).WECHAT_REPLY_COOLDOWN_MS,
    ) ?? DEFAULT_REPLY_COOLDOWN_MS
  );
}
