const STORAGE_KEY = "wechat.chatListWidth"
export const DEFAULT_CHAT_LIST_WIDTH = 260
export const MIN_CHAT_LIST_WIDTH = 200
export const MAX_CHAT_LIST_WIDTH = 420

export function clampChatListWidth(px: number): number {
  return Math.min(MAX_CHAT_LIST_WIDTH, Math.max(MIN_CHAT_LIST_WIDTH, px))
}

export function applyChatListWidth(px: number): void {
  const width = clampChatListWidth(px)
  document.documentElement.style.setProperty(
    "--wechat-chatlist-width",
    `${width}px`,
  )
}

export function readStoredChatListWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CHAT_LIST_WIDTH
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? clampChatListWidth(n) : DEFAULT_CHAT_LIST_WIDTH
  } catch {
    return DEFAULT_CHAT_LIST_WIDTH
  }
}

export function persistChatListWidth(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampChatListWidth(px)))
  } catch {
    // ignore quota errors
  }
}

export function setChatListDragActive(active: boolean): void {
  document.documentElement.classList.toggle("wechat-chatlist-dragging", active)
}

/** Percentage (0–100) of inbox row width → pixel chat-list width. */
export function chatListWidthFromPercent(
  percent: number,
  containerWidth: number,
): number {
  return clampChatListWidth((percent / 100) * containerWidth)
}

export function currentChatListWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--wechat-chatlist-width",
  )
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : DEFAULT_CHAT_LIST_WIDTH
}
