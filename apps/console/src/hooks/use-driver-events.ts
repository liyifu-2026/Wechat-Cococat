import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { DRIVER_BASE_URL } from "@/lib/cococat-endpoints"
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

function useLegacyDriverWebSocket(
  enabled: boolean,
  selectedChatId: string | null,
  onChatsChanged: (chatIds: string[]) => void,
  onSelectedChatActivity?: (chatId: string) => void,
) {
  useEffect(() => {
    if (!enabled) return

    let ws: WebSocket | null = null
    let cancelled = false
    let retryMs = 1000

    function connect() {
      if (cancelled) return
      const wsBase = DRIVER_BASE_URL.replace(/^http/, "ws")
      ws = new WebSocket(`${wsBase}/api/ws/events`)

      ws.onopen = () => {
        retryMs = 1000
      }

      ws.onmessage = (ev) => {
        try {
          handleNewMessagesPayload(
            JSON.parse(String(ev.data)) as unknown,
            onChatsChanged,
            onSelectedChatActivity,
            selectedChatId,
          )
        } catch {
          // ignore malformed payloads
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        window.setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 1.5, 15_000)
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      ws?.close()
    }
  }, [enabled, onChatsChanged, onSelectedChatActivity, selectedChatId])
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

  useLegacyDriverWebSocket(
    enabled && !isTauri(),
    selectedChatId,
    onChatsChanged,
    onSelectedChatActivity,
  )
}
