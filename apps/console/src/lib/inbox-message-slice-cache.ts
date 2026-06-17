import type { DriverMessage } from "@/lib/driver-types"
import { LruChatSliceCache } from "@/lib/lru-chat-slice-cache"

/** Max recent inbox chats kept in memory for instant re-open. */
export const INBOX_MESSAGE_SLICE_LRU_MAX = 20

export type InboxMessageSlice = {
  messages: DriverMessage[]
  hasMoreOlder: boolean
  viewMode: "latest"
}

const cache = new LruChatSliceCache<InboxMessageSlice>(INBOX_MESSAGE_SLICE_LRU_MAX)

export const inboxMessageSliceCache = {
  get(chatId: string): InboxMessageSlice | undefined {
    if (!chatId) return undefined
    return cache.get(chatId)
  },

  set(chatId: string, slice: InboxMessageSlice): void {
    if (!chatId || slice.messages.length === 0) return
    cache.set(chatId, slice)
  },

  clear(chatId: string): void {
    if (!chatId) return
    cache.delete(chatId)
  },
}
