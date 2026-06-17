import type { MaintainerPickCandidate } from "../escalation/types.js";

/** 维护者消歧：序号 / 备注名 / chatId 后缀。 */
export function pickMaintainerCandidate<T extends MaintainerPickCandidate>(
  candidates: T[],
  input: string,
): T | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const asIndex = Number(trimmed);
  if (
    Number.isInteger(asIndex) &&
    asIndex >= 1 &&
    asIndex <= candidates.length
  ) {
    return candidates[asIndex - 1] ?? null;
  }

  const lower = trimmed.toLowerCase();
  const exact = candidates.find(
    (c) => c.chatName === trimmed || c.chatId === trimmed,
  );
  if (exact) return exact;

  const suffixHit = candidates.filter((c) =>
    c.chatId.toLowerCase().endsWith(lower),
  );
  if (suffixHit.length === 1) return suffixHit[0]!;

  const nameHits = candidates.filter(
    (c) =>
      c.chatName.toLowerCase().includes(lower) ||
      lower.includes(c.chatName.toLowerCase()),
  );
  if (nameHits.length === 1) return nameHits[0]!;

  return null;
}
