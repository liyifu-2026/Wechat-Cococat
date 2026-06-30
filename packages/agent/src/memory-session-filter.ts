const SESSION_LINE_RE = /\bSession:\s*([^\]\n\r]+?)(?=\s*(?:\[|$))/g;

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitMemoryBlocks(text: string): string[] {
  const blocks = text
    .split(/\n(?=---\n)/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks : [text.trim()];
}

function blockSessions(block: string): string[] {
  return [...block.matchAll(SESSION_LINE_RE)]
    .map((m) => m[1]?.trim())
    .filter((v): v is string => Boolean(v));
}

export function filterMemoryTextForSession(
  sessionKey: string,
  text: string | undefined,
): string | undefined {
  const trimmed = text?.trim();
  const key = sessionKey.trim();
  if (!trimmed || !key) return undefined;

  const blocks = splitMemoryBlocks(trimmed);
  const blocksWithSessions = blocks
    .map((block) => ({ block, sessions: blockSessions(block) }))
    .filter((entry) => entry.sessions.length > 0);

  if (blocksWithSessions.length === 0) {
    return undefined;
  }

  const keyRe = new RegExp(`^${escapeRegexLiteral(key)}$`);
  const kept = blocksWithSessions
    .filter((entry) => entry.sessions.some((s) => keyRe.test(s)))
    .map((entry) => entry.block);

  return kept.length > 0 ? kept.join("\n\n").trim() : undefined;
}

