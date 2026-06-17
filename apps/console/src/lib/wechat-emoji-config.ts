import { emojiMap, type WechatEmoji } from "wechat-emoji-renderer"
import wechatEmojiSprite from "wechat-emoji-renderer/src/assets/sprite.png"

/** Actual sprite sheet dimensions (library assumes 32×32 cells — mismatched). */
export const WECHAT_EMOJI_SPRITE_URL = wechatEmojiSprite
export const WECHAT_EMOJI_SPRITE_WIDTH = 500
export const WECHAT_EMOJI_SPRITE_HEIGHT = 720
export const WECHAT_EMOJI_COLS = 9
export const WECHAT_EMOJI_ROWS = 12

export const WECHAT_EMOJI_CODE_RE = /\[[^\]]+\]/

export type WechatEmojiStyleOptions = {
  /** Target rendered height in px (width follows sprite cell aspect ratio). */
  emojiSize?: number
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function styleToString(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const prop = key.replace(/([A-Z])/g, "-$1").toLowerCase()
      const val = typeof value === "number" ? `${value}px` : value
      return `${prop}:${val}`
    })
    .join(";")
}

export function wechatEmojiInlineStyle(
  position: [number, number],
  displayHeight: number,
): Record<string, string | number> {
  const [row, col] = position
  const rowIndex = row - 1
  const colIndex = col - 1
  const cellW = WECHAT_EMOJI_SPRITE_WIDTH / WECHAT_EMOJI_COLS
  const cellH = WECHAT_EMOJI_SPRITE_HEIGHT / WECHAT_EMOJI_ROWS
  const scale = displayHeight / cellH
  const displayW = cellW * scale
  const displayH = cellH * scale
  const spriteW = WECHAT_EMOJI_SPRITE_WIDTH * scale
  const spriteH = WECHAT_EMOJI_SPRITE_HEIGHT * scale
  const x = -(colIndex * cellW * scale)
  const y = -(rowIndex * cellH * scale)

  return {
    display: "inline-block",
    verticalAlign: "middle",
    width: displayW,
    height: displayH,
    margin: "0 1px",
    flexShrink: 0,
    backgroundImage: `url(${WECHAT_EMOJI_SPRITE_URL})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `${x}px ${y}px`,
    backgroundSize: `${spriteW}px ${spriteH}px`,
  }
}

function renderEmojiSpan(emoji: WechatEmoji, emojiSize: number, className: string) {
  const styleString = styleToString(wechatEmojiInlineStyle(emoji.position, emojiSize))
  return `<span class="wechat-emoji ${className}" style="${styleString}" title="${escapeHtml(emoji.name)}" aria-label="${escapeHtml(emoji.name)}"></span>`
}

/** Build one compose/widget emoji span — same HTML path as message bubbles. */
export function renderComposeEmojiWidgetHtml(
  code: string,
  emojiSize = 22,
  className = "",
): string | null {
  const emoji = emojiMap.get(code)
  if (!emoji) return null
  return renderEmojiSpan(emoji, emojiSize, className)
}

export function renderWechatEmojiHtml(
  text: string,
  options: WechatEmojiStyleOptions & { className?: string } = {},
): string {
  const emojiSize = options.emojiSize ?? 20
  const className = options.className ?? ""

  if (!WECHAT_EMOJI_CODE_RE.test(text)) {
    return escapeHtml(text)
  }

  const parts: string[] = []
  const re = /\[[^\]]+\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)))
    }
    const code = match[0]
    const emoji = emojiMap.get(code)
    parts.push(emoji ? renderEmojiSpan(emoji, emojiSize, className) : escapeHtml(code))
    lastIndex = match.index + code.length
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)))
  }

  return parts.join("")
}

export function hasWechatEmojiCodes(text: string): boolean {
  if (!WECHAT_EMOJI_CODE_RE.test(text)) return false
  return /\[[^\]]+\]/.test(text) && [...text.matchAll(/\[[^\]]+\]/g)].some((m) => emojiMap.has(m[0]))
}
