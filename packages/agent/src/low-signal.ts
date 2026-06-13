import type { Message } from "@cococat/shared";

const WECHAT_TYPE_EMOJI = 47;

function isEmojiOnlyMessage(msg: Message): boolean {
  const baseType = msg.type & 0x7fffffff;
  if (baseType === WECHAT_TYPE_EMOJI || msg.mediaKind === "emoji") {
    return true;
  }
  const text = msg.content?.trim() ?? "";
  if (!text) return true;
  if (/^\[emoji\]$/i.test(text)) return true;
  if (/^\[动画表情\]$/u.test(text)) return true;
  return false;
}

/** 规则层无歧义低信号：空轮、纯表情（不含嗯/好等短附和）。 */
export function isUnambiguousLowSignal(messages: Message[]): boolean {
  if (messages.length === 0) return true;
  return messages.every((m) => isEmojiOnlyMessage(m));
}
