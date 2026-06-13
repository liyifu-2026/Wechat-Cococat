import { create } from "zustand"
import {
  listEscalationMutes,
  unmuteEscalationChat,
  type EscalationMuteEntry,
} from "@/lib/agent-config-client"

interface InboxMuteState {
  mutes: EscalationMuteEntry[]
  busyChatId: string | null
  batchBusy: boolean
  refreshMutes: () => Promise<void>
  unmuteChat: (chatId: string) => Promise<boolean>
  markAllDone: () => Promise<number>
}

export const useInboxMuteStore = create<InboxMuteState>((set, get) => ({
  mutes: [],
  busyChatId: null,
  batchBusy: false,

  refreshMutes: async () => {
    try {
      set({ mutes: await listEscalationMutes() })
    } catch {
      set({ mutes: [] })
    }
  },

  unmuteChat: async (chatId: string) => {
    if (!chatId.trim()) return false
    set({ busyChatId: chatId })
    try {
      const changed = await unmuteEscalationChat(chatId)
      if (changed) {
        set((s) => ({
          mutes: s.mutes.filter((m) => m.chat_id !== chatId),
        }))
      }
      await get().refreshMutes()
      return changed
    } finally {
      set({ busyChatId: null })
    }
  },

  markAllDone: async () => {
    const { mutes, refreshMutes } = get()
    if (mutes.length === 0) return 0
    set({ batchBusy: true })
    let count = 0
    try {
      for (const m of mutes) {
        const changed = await unmuteEscalationChat(m.chat_id)
        if (changed) count += 1
      }
      await refreshMutes()
      return count
    } finally {
      set({ batchBusy: false })
    }
  },
}))
