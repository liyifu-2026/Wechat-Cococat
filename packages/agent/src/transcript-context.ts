import type { TranscriptEntry } from "./transcript.js";

/** unified gate 小模型用的近期对话摘要。 */
export function formatTranscriptForGate(
  entries: TranscriptEntry[],
  limit = 8,
): string {
  const tail = entries.slice(-limit);
  if (tail.length === 0) return "（无近期对话）";
  return tail
    .map((e) => (e.role === "assistant" ? `我: ${e.text}` : e.text))
    .join("\n");
}
