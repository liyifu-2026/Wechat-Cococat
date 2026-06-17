import { useCallback, useMemo } from "react"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"

export function useInboxMutes() {
  const mutes = useInboxMuteStore((s) => s.mutes)
  const busyChatId = useInboxMuteStore((s) => s.busyChatId)
  const batchBusy = useInboxMuteStore((s) => s.batchBusy)
  const refreshMutes = useInboxMuteStore((s) => s.refreshMutes)
  const unmuteChat = useInboxMuteStore((s) => s.unmuteChat)
  const muteChat = useInboxMuteStore((s) => s.muteChat)
  const markAllDone = useInboxMuteStore((s) => s.markAllDone)

  const muteByChatId = useMemo(() => {
    const map = new Map<string, (typeof mutes)[number]>()
    for (const m of mutes) {
      map.set(m.chat_id, m)
    }
    return map
  }, [mutes])

  const markChatDone = useCallback(
    async (chatId: string) => unmuteChat(chatId),
    [unmuteChat],
  )

  return {
    mutes,
    muteByChatId,
    busyChatId,
    batchBusy,
    refreshMutes,
    unmuteChat,
    muteChat,
    markChatDone,
    markAllDone,
  }
}
