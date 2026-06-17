import { useCallback, useEffect, useRef, useState } from "react"
import type { DriverMessage } from "@/lib/driver-client"
import {
  type HistoryTab,
  scanHistoryMessages,
} from "@/lib/inbox-chat-history"

export function useChatHistory(chatId: string | null, open: boolean) {
  const [tab, setTab] = useState<HistoryTab>("all")
  const [items, setItems] = useState<DriverMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const scanOffsetRef = useRef(0)
  const loadingRef = useRef(false)

  const reset = useCallback(() => {
    setItems([])
    scanOffsetRef.current = 0
    setExhausted(false)
  }, [])

  const appendScan = useCallback(
    async (initial: boolean) => {
      if (!chatId || loadingRef.current) return
      loadingRef.current = true
      if (initial) setLoading(true)
      else setLoadingMore(true)
      try {
        const result = await scanHistoryMessages(
          chatId,
          tab,
          scanOffsetRef.current,
        )
        scanOffsetRef.current = result.nextOffset
        setExhausted(result.exhausted)
        if (result.matches.length > 0) {
          setItems((prev) => {
            const ids = new Set(prev.map((m) => m.localId))
            const added = result.matches.filter((m) => !ids.has(m.localId))
            return added.length > 0 ? [...prev, ...added] : prev
          })
        }
      } catch {
        setExhausted(true)
      } finally {
        loadingRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [chatId, tab],
  )

  useEffect(() => {
    if (!open || !chatId) return
    reset()
    void appendScan(true)
  }, [open, chatId, tab, reset, appendScan])

  const loadMore = useCallback(() => {
    if (exhausted || loading || loadingMore) return
    void appendScan(false)
  }, [appendScan, exhausted, loading, loadingMore])

  return {
    tab,
    setTab,
    items,
    loading,
    loadingMore,
    exhausted,
    loadMore,
  }
}
