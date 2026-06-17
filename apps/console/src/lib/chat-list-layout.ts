import {
  clampChatListWidth,
  MAX_CHAT_LIST_WIDTH,
  MIN_CHAT_LIST_WIDTH,
} from "@/lib/chat-list-width"

/** Minimum width reserved for the message column (px). */
export const INBOX_MAIN_MIN_WIDTH = 280

/** Viewport width below which list min/max are dynamically clamped. */
export const VIEWPORT_CLAMP_BREAKPOINT = 768

/** Resizable handle + flex gap allowance (px). */
const PANEL_GROUP_GUTTER = 6

/** Smallest list width when the viewport is collapsed. */
const COLLAPSED_LIST_MIN_WIDTH = 120

export type ChatListPanelSizes = {
  minSize: string
  maxSize: string
}

/**
 * Derive react-resizable-panels v4 pixel constraints for the chat list column.
 * Keeps the message column at least {@link INBOX_MAIN_MIN_WIDTH}px wide.
 */
export function resolveChatListPanelSizes(
  availableWidth: number,
): ChatListPanelSizes {
  const safeWidth = Math.max(0, availableWidth - PANEL_GROUP_GUTTER)
  const listMax = Math.min(
    MAX_CHAT_LIST_WIDTH,
    Math.max(0, safeWidth - INBOX_MAIN_MIN_WIDTH),
  )

  if (safeWidth < VIEWPORT_CLAMP_BREAKPOINT) {
    const elasticMin = Math.max(
      COLLAPSED_LIST_MIN_WIDTH,
      Math.floor(safeWidth * 0.25),
    )
    const minPx = Math.min(elasticMin, listMax)
    return {
      minSize: `${minPx}px`,
      maxSize: `${listMax}px`,
    }
  }

  const minPx = Math.min(MIN_CHAT_LIST_WIDTH, listMax)
  return {
    minSize: `${minPx}px`,
    maxSize: `${listMax}px`,
  }
}

export function defaultChatListPanelSize(storedPx: number): string {
  return `${clampChatListWidth(storedPx)}px`
}
