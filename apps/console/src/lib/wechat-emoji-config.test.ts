import { describe, expect, it } from "vitest"
import { emojiMap } from "wechat-emoji-renderer"
import {
  hasWechatEmojiCodes,
  renderWechatEmojiHtml,
  wechatEmojiInlineStyle,
} from "@/lib/wechat-emoji-config"

describe("wechat-emoji-config", () => {
  it("positions sprite against the real 500×720 sheet", () => {
    const style = wechatEmojiInlineStyle([1, 1], 20)
    const cellH = 720 / 12
    const scale = 20 / cellH
    expect(style.height).toBe(20)
    expect(style.width).toBeCloseTo((500 / 9) * scale, 1)
    expect(style.backgroundPosition).toBe("0px 0px")
  })

  it("renders known codes and leaves unknown bracket text escaped", () => {
    const html = renderWechatEmojiHtml("你好[微笑]和[未知]")
    expect(html).toContain("wechat-emoji")
    expect(html).toContain("你好")
    expect(html).toContain("[未知]")
    expect(hasWechatEmojiCodes("你好[微笑]")).toBe(true)
    expect(hasWechatEmojiCodes("[未知]")).toBe(false)
    expect(emojiMap.has("[微笑]")).toBe(true)
  })
})
