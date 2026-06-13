export const WIKI_SYSTEM_PROMPT_APPEND = `
【知识库】
需要查资料时再用 wiki_search / wiki_read_page；找到了像自己记得一样说，别提 wiki 或检索。`;

/** @deprecated 使用 system-prompt.ts + discipline.ts */
export const DEFAULT_WECHAT_SYSTEM_PROMPT = `You are chatting on WeChat. Reply naturally like texting a friend.`;

/** @deprecated 使用 buildSystemPrompt from system-prompt.ts */
export function buildSystemPrompt(
  base: string | undefined,
  wikiEnabled: boolean,
): string {
  const prompt = base ?? DEFAULT_WECHAT_SYSTEM_PROMPT;
  return wikiEnabled ? prompt + WIKI_SYSTEM_PROMPT_APPEND : prompt;
}
