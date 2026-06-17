import { useMemo } from "react"
import {
  hasWechatEmojiCodes,
  renderWechatEmojiHtml,
} from "@/lib/wechat-emoji-config"
import { cn } from "@/lib/utils"

type WechatEmojiTextProps = {
  text: string
  emojiSize?: number
  className?: string
}

export function WechatEmojiText({
  text,
  emojiSize = 20,
  className,
}: WechatEmojiTextProps) {
  const html = useMemo(
    () =>
      hasWechatEmojiCodes(text)
        ? renderWechatEmojiHtml(text, { emojiSize })
        : null,
    [emojiSize, text],
  )

  if (!html) {
    return <span className={className}>{text}</span>
  }

  return (
    <span
      className={cn("wechat-emoji-text", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
