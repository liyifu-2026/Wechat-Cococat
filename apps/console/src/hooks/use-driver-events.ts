import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import {
  DRIVER_NEW_MESSAGES_EVENT,
  parseDriverEvent,
} from "@/lib/driver-events"
import { isTauri } from "@/lib/tauri-window"

type UseDriverEventsOptions = {
  enabled: boolean
  selectedChatId: string | null
  onChatsChanged: (chatIds: string[]) => void
  onSelectedChatActivity?: (chatId: string) => void
}

export type { DriverNewMessagesEvent } from "@/lib/driver-events"

function handleNewMessagesPayload(
  raw: unknown,
  onChatsChanged: (chatIds: string[]) => void,
  onSelectedChatActivity: ((chatId: string) => void) | undefined,
  selectedChatId: string | null,
) {
  const parsed = parseDriverEvent(raw)
  if (!parsed || parsed.chats.length === 0) return
  const ids = parsed.chats.map((c) => c.chatId)
  onChatsChanged(ids)
  if (selectedChatId && ids.includes(selectedChatId)) {
    onSelectedChatActivity?.(selectedChatId)
  }
}

export function useDriverEvents({
  enabled,
  selectedChatId,
  onChatsChanged,
  onSelectedChatActivity,
}: UseDriverEventsOptions) {
  const onChatsRef = useRef(onChatsChanged)
  const onSelectedRef = useRef(onSelectedChatActivity)
  const selectedChatIdRef = useRef(selectedChatId)
  onChatsRef.current = onChatsChanged
  onSelectedRef.current = onSelectedChatActivity
  selectedChatIdRef.current = selectedChatId

  useEffect(() => {
    if (!enabled) return
    if (!isTauri()) return

    let unlisten: (() => void) | undefined
    let cancelled = false

    void listen<unknown>(DRIVER_NEW_MESSAGES_EVENT, (event) => {
      handleNewMessagesPayload(
        event.payload,
        (ids) => onChatsRef.current(ids),
        (chatId) => onSelectedRef.current?.(chatId),
        selectedChatIdRef.current,
      )
    }).then((fn) => {
      if (cancelled) {
        fn()
        return
      }
      unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [enabled])

}
