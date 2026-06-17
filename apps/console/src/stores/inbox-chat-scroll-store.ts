import type { DriverMessage } from "@/lib/driver-types"
import type { InboxMessageViewMode } from "@/lib/inbox-message-view"

export type ChatScrollMemory = {
  atBottom: boolean
  scrollTop: number
  viewMode: InboxMessageViewMode
  messages: DriverMessage[]
  hasMoreOlder: boolean
  hasMoreNewer: boolean
  messagesExtended: boolean
}

const memoryByChat = new Map<string, ChatScrollMemory>()

export const inboxChatScrollStore = {
  save(chatId: string, memory: ChatScrollMemory): void {
    if (!chatId) return
    memoryByChat.set(chatId, memory)
  },

  get(chatId: string): ChatScrollMemory | undefined {
    return memoryByChat.get(chatId)
  },

  clear(chatId: string): void {
    memoryByChat.delete(chatId)
  },
}
