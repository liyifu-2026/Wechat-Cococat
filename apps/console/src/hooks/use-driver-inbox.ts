import { useCallback, useEffect, useState } from "react"
import {
  DRIVER_MESSAGES_SEARCH_LIMIT,
  fetchDriverChats,
  fetchDriverMessages,
  type DriverChat,
  type DriverMessage,
} from "@/lib/driver-client"
import {
  resolveChatSearch,
  searchMessagesAcrossChats,
  type CrossChatMessageHit,
} from "@/lib/unified-inbox-search"
import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"

export function useDriverInbox(enabled = true) {
  const [chats, setChats] = useState<DriverChat[]>([])
  const [selectedChat, setSelectedChat] = useState<DriverChat | null>(null)
  const [messages, setMessages] = useState<DriverMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [listQuery, setListQuery] = useState("")
  const [messageQuery, setMessageQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [displayChats, setDisplayChats] = useState<DriverChat[]>([])
  const [messageHits, setMessageHits] = useState<CrossChatMessageHit[]>([])

  const refreshChats = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const next = await fetchDriverChats(40)
      setChats(next)
      setSelectedChat((prev) => {
        if (!prev) return null
        return next.find((c) => c.id === prev.id) ?? prev
      })
      if (!opts?.silent) setError(null)
    } catch (err) {
      if (!opts?.silent) {
        setChats([])
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  const refreshMessages = useCallback(async (chatId: string) => {
    try {
      const next = await fetchDriverMessages(
        chatId,
        DRIVER_MESSAGES_SEARCH_LIMIT,
      )
      setMessages(next)
    } catch {
      // 轮询失败不打断当前视图
    }
  }, [])

  const loadMessages = useCallback(async (chat: DriverChat) => {
    setSelectedChat(chat)
    setMessageQuery("")
    setMessagesLoading(true)
    setError(null)
    try {
      setMessages(
        await fetchDriverMessages(chat.id, DRIVER_MESSAGES_SEARCH_LIMIT),
      )
    } catch (err) {
      setMessages([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  const selectChatById = useCallback(
    (chatId: string) => {
      const chat =
        chats.find((c) => c.id === chatId) ??
        displayChats.find((c) => c.id === chatId)
      if (chat) void loadMessages(chat)
    },
    [chats, displayChats, loadMessages],
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void refreshChats()
  }, [enabled, refreshChats])

  useVisibilityGatedInterval(
    () => void refreshChats({ silent: true }),
    enabled ? 8000 : 0,
    {
      allowedModules: ["inbox"],
      degradedIntervalMs: 60_000,
      suspendWhenHidden: true,
    },
  )

  useVisibilityGatedInterval(
    () => {
      const chatId = selectedChat?.id
      if (chatId) void refreshMessages(chatId)
    },
    enabled && selectedChat?.id ? 5000 : 0,
    {
      allowedModules: ["inbox"],
      degradedIntervalMs: 60_000,
      suspendWhenHidden: true,
    },
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const result = await resolveChatSearch(listQuery, chats)
      if (!cancelled) setDisplayChats(result)
    }
    const id = window.setTimeout(() => void run(), listQuery.trim() ? 180 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [chats, listQuery])

  useEffect(() => {
    let cancelled = false
    const q = listQuery.trim()
    if (q.length < 2) {
      setMessageHits([])
      return
    }
    const run = async () => {
      const hits = await searchMessagesAcrossChats(q, chats)
      if (!cancelled) setMessageHits(hits)
    }
    const id = window.setTimeout(() => void run(), 220)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [chats, listQuery])

  return {
    chats: displayChats,
  allChats: chats,
    messageHits,
    selectedChat,
    messages,
    messagesLoading,
    listQuery,
    setListQuery,
    messageQuery,
    setMessageQuery,
    error,
    loading,
    refreshChats,
    refreshMessages,
    loadMessages,
    selectChatById,
  }
}
