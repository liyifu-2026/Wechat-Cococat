/** 客户侧回复禁词 — 与 Console `stealth-check.ts` 保持同步 */
export const STEALTH_BANNED_WORDS = [
  "机器人",
  "人工智能",
  "ai",
  "大模型",
  "知识库",
  "语言模型",
  "chatgpt",
  "openai",
  "gpt",
  "我是助手",
  "我是模型",
] as const;

export type StealthCheckResult = {
  ok: boolean;
  hits: string[];
};

export function checkStealthText(text: string): StealthCheckResult {
  const low = text.toLowerCase();
  const hits = STEALTH_BANNED_WORDS.filter((w) => low.includes(w.toLowerCase()));
  return { ok: hits.length === 0, hits: [...hits] };
}
