import { create } from "zustand"
import type { DriverChat } from "@/lib/driver-client"

interface InboxUnreadState {
  /** Chat ids with driver-reported unread messages. */
  unreadChatIds: string[]
  bulkSetFromChats: (chats: Iterable<DriverChat>) => void
}

export const useInboxUnreadStore = create<InboxUnreadState>((set) => ({
  unreadChatIds: [],

  bulkSetFromChats: (chats) => {
    const ids: string[] = []
    for (const chat of chats) {
      if ((chat.unreadCount ?? 0) > 0) ids.push(chat.id)
    }
    set({ unreadChatIds: ids })
  },
}))

/** Distinct chats needing attention: escalation mutes + unread. */
export function countInboxAttentionChats(
  muteChatIds: Iterable<string>,
  unreadChatIds: Iterable<string>,
): number {
  return new Set([...muteChatIds, ...unreadChatIds]).size
}
