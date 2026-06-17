import { useCallback, useEffect, useRef, useState } from "react"
import {
  INITIAL_MESSAGE_LIMIT,
  LOAD_MORE_PAGE,
  fetchDriverChats,
  fetchDriverContact,
  fetchDriverMessages,
  fetchDriverMessagesAfter,
  fetchDriverMessagesAround,
  fetchDriverMessagesBefore,
  type DriverChat,
  type DriverMessage,
} from "@/lib/driver-client"
import {
  contactToChat,
  minimalChatFromId,
} from "@/lib/driver-types"
import {
  mergeUniqueMessagesDesc,
  newestMessageUnix,
  oldestMessageUnix,
} from "@/lib/inbox-message-window"
import {
  applyOptimisticLayer,
  buildOptimisticMessage,
  createClientMsgId,
  SEND_RECONCILE_DELAYS_MS,
  stripPendingMessages,
  type OptimisticPending,
} from "@/lib/inbox-optimistic-send"
import type { InboxMessageViewMode } from "@/lib/inbox-message-view"
import { inboxMessageSliceCache } from "@/lib/inbox-message-slice-cache"
import { inboxChatScrollStore } from "@/stores/inbox-chat-scroll-store"
import { useInboxLastActivityStore } from "@/stores/inbox-last-activity-store"
import { useInboxUnreadStore } from "@/stores/inbox-unread-store"
import i18n from "@/i18n/index"
import { messageTimestampMs } from "@/lib/inbox-profile"
import {
  resolveChatSearch,
  searchMessagesAcrossChats,
  type CrossChatMessageHit,
} from "@/lib/unified-inbox-search"
import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"

function messageTime(m: DriverMessage): number {
  const t = Date.parse(m.timestamp ?? "")
  return Number.isNaN(t) ? 0 : t
}

/** Merge a fresh latest page into an extended history without dropping older rows. */
export function mergeLatestMessages(
  prev: DriverMessage[],
  latest: DriverMessage[],
  extended: boolean,
): DriverMessage[] {
  if (!extended || prev.length === 0) return latest
  const byId = new Map<number, DriverMessage>()
  for (const m of prev) {
    if (m.localId != null) byId.set(m.localId, m)
  }
  for (const m of latest) {
    if (m.localId != null) byId.set(m.localId, m)
  }
  return [...byId.values()].sort((a, b) => messageTime(b) - messageTime(a))
}

export type { InboxMessageViewMode } from "@/lib/inbox-message-view"

export function useDriverInbox(enabled = true) {
  const [chats, setChats] = useState<DriverChat[]>([])
  const [selectedChat, setSelectedChat] = useState<DriverChat | null>(null)
  const [messages, setMessages] = useState<DriverMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [hasMoreNewer, setHasMoreNewer] = useState(false)
  const [messageViewMode, setMessageViewMode] =
    useState<InboxMessageViewMode>("latest")
  const [pendingScrollLocalId, setPendingScrollLocalId] = useState<
    number | null
  >(null)
  const [scrollRestoreTop, setScrollRestoreTop] = useState<number | null>(
    null,
  )
  const [listQuery, setListQuery] = useState("")
  const [messageQuery, setMessageQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [displayChats, setDisplayChats] = useState<DriverChat[]>([])
  const [messageHits, setMessageHits] = useState<CrossChatMessageHit[]>([])
  const [messageHitsLoading, setMessageHitsLoading] = useState(false)
  const messagesExtendedRef = useRef(false)
  const viewModeRef = useRef<InboxMessageViewMode>("latest")
  const selectedChatIdRef = useRef<string | null>(null)
  const pendingByChatRef = useRef<Map<string, OptimisticPending[]>>(new Map())
  const reconcileTimersRef = useRef<Map<string, number[]>>(new Map())

  const getPendings = useCallback((chatId: string) => {
    return pendingByChatRef.current.get(chatId) ?? []
  }, [])

  const setPendings = useCallback((chatId: string, next: OptimisticPending[]) => {
    if (next.length === 0) {
      pendingByChatRef.current.delete(chatId)
    } else {
      pendingByChatRef.current.set(chatId, next)
    }
  }, [])

  const applyMessagesWithOptimistic = useCallback(
    (chatId: string, serverMessages: DriverMessage[]) => {
      const { messages, resolvedClientIds } = applyOptimisticLayer(
        serverMessages,
        getPendings(chatId),
      )
      if (resolvedClientIds.length > 0) {
        const remaining = getPendings(chatId).filter(
          (p) => !resolvedClientIds.includes(p.clientMsgId),
        )
        setPendings(chatId, remaining)
        if (remaining.length === 0) {
          const timers = reconcileTimersRef.current.get(chatId)
          if (timers) {
            for (const id of timers) window.clearTimeout(id)
            reconcileTimersRef.current.delete(chatId)
          }
        }
      }
      return messages
    },
    [getPendings, setPendings],
  )

  useEffect(() => {
    selectedChatIdRef.current = selectedChat?.id ?? null
  }, [selectedChat?.id])

  const revalidateLatestMessages = useCallback(
    async (chat: DriverChat) => {
      try {
        const next = await fetchDriverMessages(chat.id, INITIAL_MESSAGE_LIMIT, 0)
        if (selectedChatIdRef.current !== chat.id) return
        const applied = applyMessagesWithOptimistic(chat.id, next)
        const hasMore = next.length >= INITIAL_MESSAGE_LIMIT
        setMessages(applied)
        setHasMoreOlder(hasMore)
        inboxMessageSliceCache.set(chat.id, {
          messages: applied,
          hasMoreOlder: hasMore,
          viewMode: "latest",
        })
      } catch {
        // keep cached view on background failure
      }
    },
    [applyMessagesWithOptimistic],
  )

  const refreshMessagesInner = useCallback(
    async (chatId: string) => {
      try {
        const latest = await fetchDriverMessages(
          chatId,
          INITIAL_MESSAGE_LIMIT,
          0,
        )
        setMessages((prev) => {
          const merged = mergeLatestMessages(
            stripPendingMessages(prev),
            latest,
            messagesExtendedRef.current,
          )
          return applyMessagesWithOptimistic(chatId, merged)
        })
      } catch {
        // 轮询失败不打断当前视图
      }
    },
    [applyMessagesWithOptimistic],
  )

  const refreshMessages = useCallback(
    async (chatId: string) => {
      await refreshMessagesInner(chatId)
    },
    [refreshMessagesInner],
  )

  const scheduleSendReconcile = useCallback(
    (chatId: string) => {
      const prev = reconcileTimersRef.current.get(chatId) ?? []
      for (const id of prev) window.clearTimeout(id)

      const timers = SEND_RECONCILE_DELAYS_MS.map((delay) =>
        window.setTimeout(() => {
          if ((pendingByChatRef.current.get(chatId)?.length ?? 0) > 0) {
            void refreshMessagesInner(chatId)
          }
        }, delay),
      )
      reconcileTimersRef.current.set(chatId, timers)
    },
    [refreshMessagesInner],
  )

  const appendOptimisticSend = useCallback(
    (chatId: string, text: string): string => {
      const clientMsgId = createClientMsgId()
      const pending: OptimisticPending = {
        clientMsgId,
        chatId,
        text,
        createdAt: Date.now(),
      }
      setPendings(chatId, [...getPendings(chatId), pending])
      const optimistic = buildOptimisticMessage(pending)
      setMessages((prev) => [
        optimistic,
        ...stripPendingMessages(prev).filter(
          (m) => m.clientMsgId !== clientMsgId,
        ),
      ])
      return clientMsgId
    },
    [getPendings, setPendings],
  )

  const revertOptimisticSend = useCallback(
    (chatId: string, clientMsgId: string) => {
      setPendings(
        chatId,
        getPendings(chatId).filter((p) => p.clientMsgId !== clientMsgId),
      )
      setMessages((prev) =>
        prev.filter((m) => m.clientMsgId !== clientMsgId || !m.pending),
      )
    },
    [getPendings, setPendings],
  )

  const onMessageSent = useCallback(
    (chatId: string) => {
      scheduleSendReconcile(chatId)
      void refreshMessagesInner(chatId)
    },
    [refreshMessagesInner, scheduleSendReconcile],
  )

  const refreshChatsBusy = useRef(false)

  const refreshChats = useCallback(async (opts?: { silent?: boolean }) => {
    if (refreshChatsBusy.current) return
    refreshChatsBusy.current = true
    if (!opts?.silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const next = await fetchDriverChats(40)
      setChats((prev) => {
        const nextIds = new Set(next.map((c) => c.id))
        const synthetic = prev.filter((c) => !nextIds.has(c.id))
        const merged = synthetic.length > 0 ? [...synthetic, ...next] : next
        useInboxUnreadStore.getState().bulkSetFromChats(merged)
        return merged
      })
      useInboxLastActivityStore.getState().bulkSetFromChats(next)
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
      refreshChatsBusy.current = false
    }
  }, [])

  const resetLatestView = useCallback(() => {
    viewModeRef.current = "latest"
    setMessageViewMode("latest")
    messagesExtendedRef.current = false
    setHasMoreNewer(false)
    setPendingScrollLocalId(null)
  }, [])

  const captureScrollMemory = useCallback(
    (
      chatId: string,
      scroll: { scrollTop: number; atBottom: boolean },
    ) => {
      if (!chatId) return
      inboxChatScrollStore.save(chatId, {
        atBottom: scroll.atBottom,
        scrollTop: scroll.scrollTop,
        viewMode: viewModeRef.current,
        messages,
        hasMoreOlder,
        hasMoreNewer,
        messagesExtended: messagesExtendedRef.current,
      })
      if (
        scroll.atBottom &&
        viewModeRef.current === "latest" &&
        !messagesExtendedRef.current &&
        messages.length > 0
      ) {
        inboxMessageSliceCache.set(chatId, {
          messages,
          hasMoreOlder,
          viewMode: "latest",
        })
      }
    },
    [hasMoreNewer, hasMoreOlder, messages],
  )

  const clearScrollRestore = useCallback(() => {
    setScrollRestoreTop(null)
  }, [])

  const loadMessages = useCallback(
    async (chat: DriverChat, opts?: { force?: boolean }) => {
      setSelectedChat(chat)
      setMessageQuery("")
      setScrollRestoreTop(null)
      setPendingScrollLocalId(null)

      const memory =
        !opts?.force ? inboxChatScrollStore.get(chat.id) : undefined

      if (memory && memory.messages.length > 0) {
        viewModeRef.current = memory.viewMode
        setMessageViewMode(memory.viewMode)
        messagesExtendedRef.current = memory.messagesExtended
        setMessages(memory.messages)
        setHasMoreOlder(memory.hasMoreOlder)
        setHasMoreNewer(memory.hasMoreNewer)
        setMessagesLoading(false)
        setError(null)
        setScrollRestoreTop(memory.atBottom ? null : memory.scrollTop)
        return
      }

      const cached = !opts?.force ? inboxMessageSliceCache.get(chat.id) : undefined
      if (cached) {
        resetLatestView()
        setMessages(applyMessagesWithOptimistic(chat.id, cached.messages))
        setHasMoreOlder(cached.hasMoreOlder)
        setMessagesLoading(false)
        setError(null)
        void revalidateLatestMessages(chat)
        return
      }

      resetLatestView()
      setHasMoreOlder(true)
      setMessagesLoading(true)
      setError(null)
      try {
        const next = await fetchDriverMessages(chat.id, INITIAL_MESSAGE_LIMIT, 0)
        const applied = applyMessagesWithOptimistic(chat.id, next)
        const hasMore = next.length >= INITIAL_MESSAGE_LIMIT
        setMessages(applied)
        setHasMoreOlder(hasMore)
        inboxMessageSliceCache.set(chat.id, {
          messages: applied,
          hasMoreOlder: hasMore,
          viewMode: "latest",
        })
      } catch (err) {
        setMessages([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setMessagesLoading(false)
      }
    },
    [applyMessagesWithOptimistic, revalidateLatestMessages, resetLatestView],
  )

  const clearSelectedChat = useCallback(() => {
    setSelectedChat(null)
    setMessages([])
    setMessagesLoading(false)
    setScrollRestoreTop(null)
    setPendingScrollLocalId(null)
    setError(null)
    resetLatestView()
  }, [resetLatestView])

  const selectChat = useCallback(
    async (chat: DriverChat) => {
      if (selectedChat?.id === chat.id) {
        clearSelectedChat()
        return
      }
      await loadMessages(chat)
    },
    [clearSelectedChat, loadMessages, selectedChat?.id],
  )

  const jumpToMessage = useCallback(
    async (chat: DriverChat, localId: number) => {
      inboxChatScrollStore.clear(chat.id)
      inboxMessageSliceCache.clear(chat.id)
      setSelectedChat(chat)
      setMessageQuery("")
      setListQuery("")
      viewModeRef.current = "around"
      setMessageViewMode("around")
      messagesExtendedRef.current = true
      setPendingScrollLocalId(localId)
      setScrollRestoreTop(null)
      setMessagesLoading(true)
      setError(null)
      try {
        const windowMsgs = await fetchDriverMessagesAround(
          chat.id,
          localId,
          INITIAL_MESSAGE_LIMIT,
        )
        if (windowMsgs.length === 0) {
          setPendingScrollLocalId(null)
          throw new Error(i18n.t("wechat.inbox.messageJumpNotFound"))
        }
        setMessages(windowMsgs)
        const idx = windowMsgs.findIndex((m) => m.localId === localId)
        if (idx >= 0) {
          setHasMoreNewer(idx > 0)
          setHasMoreOlder(idx < windowMsgs.length - 1)
        } else {
          setHasMoreOlder(false)
          setHasMoreNewer(false)
          setPendingScrollLocalId(null)
          throw new Error(i18n.t("wechat.inbox.messageJumpNotFound"))
        }
      } catch (err) {
        setMessages([])
        setPendingScrollLocalId(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setMessagesLoading(false)
      }
    },
    [],
  )

  const returnToLatest = useCallback(async () => {
    const chat = selectedChat
    if (!chat) return
    inboxChatScrollStore.clear(chat.id)
    await loadMessages(chat, { force: true })
  }, [loadMessages, selectedChat])

  const clearPendingScroll = useCallback(() => {
    setPendingScrollLocalId(null)
  }, [])

  const loadOlderMessages = useCallback(async () => {
    const chat = selectedChat
    if (!chat || loadingOlder || !hasMoreOlder) return false

    setLoadingOlder(true)
    try {
      if (viewModeRef.current === "around") {
        const before = oldestMessageUnix(messages)
        if (before == null) return false
        const older = await fetchDriverMessagesBefore(
          chat.id,
          before,
          LOAD_MORE_PAGE,
        )
        if (older.length < LOAD_MORE_PAGE) setHasMoreOlder(false)
        if (older.length === 0) return false
        setMessages((prev) => mergeUniqueMessagesDesc(prev, older))
        return true
      }

      const older = await fetchDriverMessages(
        chat.id,
        LOAD_MORE_PAGE,
        messages.length,
      )
      if (older.length < LOAD_MORE_PAGE) setHasMoreOlder(false)
      if (older.length === 0) return false

      messagesExtendedRef.current = true
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.localId))
        const added = older.filter((m) => !ids.has(m.localId))
        return added.length > 0 ? [...prev, ...added] : prev
      })
      return true
    } catch {
      return false
    } finally {
      setLoadingOlder(false)
    }
  }, [hasMoreOlder, loadingOlder, messages, selectedChat])

  const loadNewerMessages = useCallback(async () => {
    const chat = selectedChat
    if (
      !chat ||
      loadingNewer ||
      !hasMoreNewer ||
      viewModeRef.current !== "around"
    ) {
      return false
    }

    setLoadingNewer(true)
    try {
      const after = newestMessageUnix(messages)
      if (after == null) return false
      const newer = await fetchDriverMessagesAfter(chat.id, after, LOAD_MORE_PAGE)
      if (newer.length < LOAD_MORE_PAGE) setHasMoreNewer(false)
      if (newer.length === 0) return false
      setMessages((prev) => mergeUniqueMessagesDesc(newer, prev))
      return true
    } catch {
      return false
    } finally {
      setLoadingNewer(false)
    }
  }, [hasMoreNewer, loadingNewer, messages, selectedChat])

  const resolveChatById = useCallback(
    async (chatId: string): Promise<DriverChat | null> => {
      const id = chatId.trim()
      if (!id) return null
      const existing =
        chats.find((c) => c.id === id) ??
        displayChats.find((c) => c.id === id)
      if (existing) return existing

      try {
        const contact = await fetchDriverContact(id)
        if (contact) return contactToChat(contact)
      } catch {
        // fall through to minimal chat
      }
      return minimalChatFromId(id)
    },
    [chats, displayChats],
  )

  const openChatById = useCallback(
    async (chatId: string) => {
      const chat = await resolveChatById(chatId)
      if (!chat) return
      setChats((prev) =>
        prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev],
      )
      await loadMessages(chat)
    },
    [loadMessages, resolveChatById],
  )

  /** @deprecated use openChatById */
  const selectChatById = openChatById

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void refreshChats()
  }, [enabled, refreshChats])

  useVisibilityGatedInterval(
    () => void refreshChats({ silent: true }),
    enabled ? 20_000 : 0,
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
    enabled && selectedChat?.id ? 15_000 : 0,
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
    if (q.length < 1) {
      setMessageHits([])
      setMessageHitsLoading(false)
      return
    }
    setMessageHitsLoading(true)
    const run = async () => {
      const hits = await searchMessagesAcrossChats(q, chats)
      if (!cancelled) {
        setMessageHits(hits)
        setMessageHitsLoading(false)
      }
    }
    const id = window.setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [chats, listQuery])

  useEffect(() => {
    const chatId = selectedChat?.id
    if (!chatId || messages.length === 0) return
    for (const m of messages) {
      const ms = messageTimestampMs(m)
      if (ms != null) {
        useInboxLastActivityStore.getState().touch(chatId, ms)
        break
      }
    }
  }, [messages, selectedChat?.id])

  return {
    chats: displayChats,
    allChats: chats,
    messageHits,
    messageHitsLoading,
    selectedChat,
    messages,
    messagesLoading,
    loadingOlder,
    loadingNewer,
    hasMoreOlder,
    hasMoreNewer,
    messageViewMode,
    pendingScrollLocalId,
    scrollRestoreTop,
    captureScrollMemory,
    clearScrollRestore,
    loadOlderMessages,
    loadNewerMessages,
    jumpToMessage,
    returnToLatest,
    clearPendingScroll,
    listQuery,
    setListQuery,
    messageQuery,
    setMessageQuery,
    error,
    loading,
    refreshChats,
    refreshMessages,
    loadMessages,
    selectChat,
    clearSelectedChat,
    openChatById,
    selectChatById,
    appendOptimisticSend,
    revertOptimisticSend,
    onMessageSent,
  }
}
