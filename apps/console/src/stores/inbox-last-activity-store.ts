import { create } from "zustand"
import type { DriverChat } from "@/lib/driver-client"

function parseActivityMs(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

type InboxLastActivityState = {
  byChatId: Record<string, number>
  /** Bulk hydrate from chat list on cold start / refresh. */
  bulkSetFromChats: (chats: Iterable<DriverChat>) => void
  /** O(1) incremental update on new message activity. */
  touch: (chatId: string, ms: number) => void
  getMs: (chatId: string) => number | undefined
}

export const useInboxLastActivityStore = create<InboxLastActivityState>(
  (set, get) => ({
    byChatId: {},
    bulkSetFromChats: (chats) => {
      const next: Record<string, number> = { ...get().byChatId }
      for (const chat of chats) {
        const ms = parseActivityMs(chat.lastActivityAt)
        if (ms == null) continue
        const prev = next[chat.id]
        if (prev == null || ms > prev) next[chat.id] = ms
      }
      set({ byChatId: next })
    },
    touch: (chatId, ms) => {
      if (!chatId.trim() || !Number.isFinite(ms)) return
      set((s) => {
        const prev = s.byChatId[chatId]
        if (prev != null && ms <= prev) return s
        return { byChatId: { ...s.byChatId, [chatId]: ms } }
      })
    },
    getMs: (chatId) => get().byChatId[chatId],
  }),
)

/** Subscribe to a single chat's last-activity ms without re-rendering the whole map. */
export function useChatLastActivityMs(chatId: string | null): number | undefined {
  return useInboxLastActivityStore((s) =>
    chatId ? s.byChatId[chatId] : undefined,
  )
}
