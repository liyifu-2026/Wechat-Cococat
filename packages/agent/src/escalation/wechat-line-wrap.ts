/** 微信聊天窗口单行可读宽度（汉字计） */
export const WECHAT_LINE_MAX_CHARS = 11;

/** 按字符数切分一行（CJK 友好） */
export function splitWechatLine(
  text: string,
  maxChars = WECHAT_LINE_MAX_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chars = [...trimmed];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    out.push(chars.slice(i, i + maxChars).join(""));
  }
  return out;
}

/** 将若干逻辑行展开为微信短行文本 */
export function formatWechatText(
  logicalLines: string[],
  maxChars = WECHAT_LINE_MAX_CHARS,
): string {
  const wrapped: string[] = [];
  for (const line of logicalLines) {
    if (line === "") {
      wrapped.push("");
      continue;
    }
    wrapped.push(...splitWechatLine(line, maxChars));
  }
  return wrapped.join("\n");
}

export function wechatLineCount(text: string): number {
  return [...text].length;
}

export function shortChatId(chatId: string, tail = 6): string {
  const id = chatId.trim();
  if (id.length <= tail) return id;
  return id.slice(-tail);
}
