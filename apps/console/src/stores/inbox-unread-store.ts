import { create } from "zustand"
import type { DriverChat } from "@/lib/driver-client"

interface InboxUnreadState {
  /** Chat ids with driver-reported unread messages. */
  unreadChatIds: string[]
  unreadCountsByChatId: Record<string, number>
  bulkSetFromChats: (chats: Iterable<DriverChat>) => void
  nextUnreadChatId: () => string | null
  markChatAsRead: (chatId: string) => void
  markChatAsUnread: (chatId: string) => void
}

export const useInboxUnreadStore = create<InboxUnreadState>((set, get) => ({
  unreadChatIds: [],
  unreadCountsByChatId: {},

  bulkSetFromChats: (chats) => {
    const ids: string[] = []
    const counts: Record<string, number> = {}
    for (const chat of chats) {
      const count = chat.unreadCount ?? 0
      if (count > 0) {
        ids.push(chat.id)
        counts[chat.id] = count
      }
    }
    set({ unreadChatIds: ids, unreadCountsByChatId: counts })
  },

  nextUnreadChatId: () => {
    const ids = get().unreadChatIds
    if (ids.length === 0) return null
    const [next, ...rest] = ids
    set({ unreadChatIds: [...rest, next] })
    return next ?? null
  },

  markChatAsRead: (chatId) => {
    set((s) => {
      const nextCounts = { ...s.unreadCountsByChatId }
      delete nextCounts[chatId]
      return {
        unreadChatIds: s.unreadChatIds.filter((id) => id !== chatId),
        unreadCountsByChatId: nextCounts,
      }
    })
  },

  markChatAsUnread: (chatId) => {
    set((s) => {
      const nextCounts = { ...s.unreadCountsByChatId, [chatId]: 1 }
      const nextIds = s.unreadChatIds.includes(chatId)
        ? s.unreadChatIds
        : [...s.unreadChatIds, chatId]
      return {
        unreadChatIds: nextIds,
        unreadCountsByChatId: nextCounts,
      }
    })
  },
}))

/**
 * Total attention count: sum of per-chat unread message counts + muted
 * chats without unread messages. Unlike the old distinct-chat count,
 * this produces a number that matches the natural badge expectation:
 * the sidebar number equals the sum of all chat-list item badges.
 */
export function countInboxAttentionChats(
  muteChatIds: Iterable<string>,
  unreadCountsByChatId: Record<string, number>,
): number {
  let total = 0
  for (const count of Object.values(unreadCountsByChatId)) {
    total += count
  }
  const muteSet = new Set(muteChatIds)
  // Add 1 per muted chat that has no unread count (count already
  // included for those that do).
  for (const id of muteSet) {
    if (!(id in unreadCountsByChatId)) {
      total += 1
    }
  }
  return total
}
