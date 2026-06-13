/** `12345678@chatroom` → `_12345678_chatroom` */
export function encodeChatDir(chatId: string): string {
  return `_${chatId.replace(/@/g, "_")}`;
}
