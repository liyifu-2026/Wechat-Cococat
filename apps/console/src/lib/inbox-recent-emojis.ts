import { emojiMap } from "wechat-emoji-renderer"

const STORAGE_KEY = "cococat:inbox-recent-emojis"
const MAX_RECENT = 27

export function readRecentEmojiCodes(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (code): code is string =>
        typeof code === "string" && emojiMap.has(code),
    )
  } catch {
    return []
  }
}

export function recordRecentEmojiCode(code: string): string[] {
  if (!emojiMap.has(code)) return readRecentEmojiCodes()
  const next = [code, ...readRecentEmojiCodes().filter((c) => c !== code)].slice(
    0,
    MAX_RECENT,
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota errors */
  }
  return next
}
