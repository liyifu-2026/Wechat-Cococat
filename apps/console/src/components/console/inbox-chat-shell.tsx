import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, MoreHorizontal, Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DriverChat, DriverMessage } from "@/lib/driver-client"
import type { CrossChatMessageHit } from "@/lib/unified-inbox-search"
import type { InboxListFilter } from "@/lib/console-layout"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import { isMutedEntry, isTodoMuteEntry } from "@/lib/inbox-mute-badges"
import { InboxComposeBar } from "@/components/console/inbox-compose-bar"
import { InboxChatEmptyState } from "@/components/console/inbox-chat-empty-state"
import { WechatChatChrome } from "@/components/wechat/wechat-window-controls"
import { InboxMessageMedia } from "@/components/console/inbox-message-media"
import { WechatEmojiText } from "@/components/console/wechat-emoji-text"
import { AgentProxyToggle } from "@/components/console/agent-proxy-toggle"
import { WeChatAvatar } from "@/components/console/wechat-avatar"
import type { useAgentProxy } from "@/hooks/use-agent-proxy"
import { useContactCache } from "@/hooks/use-contact-cache"
import { useChatListLayout } from "@/hooks/use-chat-list-layout"
import { useMaintainers } from "@/hooks/use-maintainers"
import { ChatListItem } from "@/components/wechat/chat-list-item"
import { ChatListContextMenu } from "@/components/wechat/chat-list-context-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  defaultChatListPanelSize,
  INBOX_MAIN_MIN_WIDTH,
  resolveChatListPanelSizes,
} from "@/lib/chat-list-layout"
import {
  applyChatListWidth,
  currentChatListWidth,
  persistChatListWidth,
  readStoredChatListWidth,
  setChatListDragActive,
} from "@/lib/chat-list-width"
import { messageDisplayBody } from "@/lib/wechat-message-body"
import {
  partitionChatsForDisplay,
  sortChatsForDisplay,
} from "@/lib/sort-chats-for-display"
import {
  contactKeysFromChats,
  contactKeysFromMessages,
} from "@/lib/contact-cache-keys"
import {
  chatDisplayName,
  formatMessageTime,
} from "@/lib/wechat-ui"
import { buildInboxImageGallery } from "@/lib/inbox-image-gallery"
import {
  MAX_COMPOSE_HEIGHT,
  MIN_COMPOSE_HEIGHT,
  persistComposeHeight,
  readStoredComposeHeight,
} from "@/lib/inbox-compose-height"
import {
  applyScrollTopWhenStable,
  cancelScrollToBottom,
  isNearScrollBottom,
  scrollToBottomReliable,
} from "@/lib/inbox-scroll-utils"
import { buildInboxMessageRows } from "@/lib/inbox-message-time-divider"
import { useLightboxStore } from "@/stores/lightbox-store"
import { useConsoleStore } from "@/stores/console-store"
import { useInboxUnreadStore } from "@/stores/inbox-unread-store"
import { isAiAssistPanelOpen, useAiAssistStore } from "@/stores/ai-assist-store"
import { InboxAiAssistOverlay } from "@/components/wechat/inbox-ai-assist-overlay"
import {
  INBOX_AI_ASSIST_HOST_ID,
  INBOX_AI_EXPAND_HOST_ID,
} from "@/lib/inbox-ai-hosts"

const MESSAGE_VIRTUALIZE_THRESHOLD = 300
const MESSAGE_ROW_ESTIMATE_PX = 84
const MESSAGE_OVERSCAN_ROWS = 12
const CHAT_LIST_VIRTUALIZE_THRESHOLD = 120
const CHAT_ROW_ESTIMATE_PX = 72
const CHAT_OVERSCAN_ROWS = 8

export type { InboxListFilter }

interface InboxChatShellProps {
  chats: DriverChat[]
  chatsLoading?: boolean
  messageHits?: CrossChatMessageHit[]
  messageHitsLoading?: boolean
  selectedChat: DriverChat | null
  messages: DriverMessage[]
  messagesLoading: boolean
  listQuery: string
  onListQueryChange: (value: string) => void
  onSelectChat: (chat: DriverChat) => void
  muteByChatId: Map<string, EscalationMuteEntry>
  onUnmuteChat?: (chatId: string) => void
  onMarkChatDone?: (chatId: string) => void
  onMarkTodoChat?: (chatId: string, chatName: string) => void
  onMuteChat?: (chatId: string, chatName: string) => void
  onMarkChatRead?: (chatId: string) => void
  onMarkChatUnread?: (chatId: string) => void
  agentProxy: ReturnType<typeof useAgentProxy>
  onRefreshMessages: (chatId: string) => void
  onBeforeSend?: (chatId: string, text: string) => string
  onSendFailed?: (chatId: string, clientMsgId: string) => void
  onComposeError?: (message: string) => void
  loadingOlder?: boolean
  hasMoreOlder?: boolean
  onLoadOlderMessages?: () => Promise<boolean>
  loadingNewer?: boolean
  hasMoreNewer?: boolean
  onLoadNewerMessages?: () => Promise<boolean>
  messageViewMode?: "latest" | "around"
  pendingScrollLocalId?: number | null
  scrollRestoreTop?: number | null
  onCaptureScrollMemory?: (
    chatId: string,
    scroll: { scrollTop: number; atBottom: boolean },
  ) => void
  onScrollRestoreApplied?: () => void
  onClearPendingScroll?: () => void
  onJumpToMessage?: (chat: DriverChat, localId: number) => void
  onReturnToLatest?: () => void
  /** Shown when chat list is empty but services appear up (e.g. DB keys missing). */
  emptyListHint?: string
  onEmptyListAction?: () => void
  emptyListActionLabel?: string
}

function isMediaMessage(m: DriverMessage): boolean {
  return (
    m.mediaKind === "image" ||
    m.mediaKind === "voice" ||
    m.mediaKind === "video" ||
    m.mediaKind === "emoji"
  )
}

function muteSummary(
  entry: EscalationMuteEntry | undefined,
  t: (key: string) => string,
): string | null {
  if (!entry) return null
  if (isTodoMuteEntry(entry)) return t("wechat.inbox.badgeTodo")
  if (isMutedEntry(entry)) return t("wechat.inbox.badgeMuted")
  return t("wechat.inbox.tagMute")
}

export function InboxChatShell({
  chats,
  chatsLoading = false,
  messageHits = [],
  messageHitsLoading = false,
  selectedChat,
  messages,
  messagesLoading,
  listQuery,
  onListQueryChange,
  onSelectChat,
  muteByChatId,
  onUnmuteChat,
  onMarkChatDone,
  onMarkTodoChat,
  onMuteChat,
  onMarkChatRead,
  onMarkChatUnread,
  agentProxy,
  onRefreshMessages,
  onBeforeSend,
  onSendFailed,
  onComposeError,
  loadingOlder = false,
  hasMoreOlder = true,
  onLoadOlderMessages,
  loadingNewer = false,
  hasMoreNewer = false,
  onLoadNewerMessages,
  messageViewMode = "latest",
  pendingScrollLocalId = null,
  scrollRestoreTop = null,
  onCaptureScrollMemory,
  onScrollRestoreApplied,
  onClearPendingScroll,
  onJumpToMessage,
  onReturnToLatest,
  emptyListHint,
  onEmptyListAction,
  emptyListActionLabel,
}: InboxChatShellProps) {
  const { t } = useTranslation()
  const navigateContactProfile = useConsoleStore((s) => s.navigateContactProfile)
  const unreadCountsByChatId = useInboxUnreadStore(
    (s) => s.unreadCountsByChatId,
  )
  const aiPanelOpen = useAiAssistStore((s) => isAiAssistPanelOpen(s.layer))
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const chatListScrollRef = useRef<HTMLUListElement>(null)
  const pendingScrollRestore = useRef<{ hOld: number; sOld: number } | null>(
    null,
  )
  const scrollToBottomOnLoad = useRef(false)
  const stickToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const prevSelectedChatIdRef = useRef<string | null>(null)
  const loadingOlderRef = useRef(false)
  const loadingNewerRef = useRef(false)
  const [highlightLocalId, setHighlightLocalId] = useState<number | null>(null)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const [messageViewport, setMessageViewport] = useState({
    scrollTop: 0,
    height: 0,
  })
  const [chatListViewport, setChatListViewport] = useState({
    scrollTop: 0,
    height: 0,
  })
  const [moreOpen, setMoreOpen] = useState(false)
  const [chatContextMenu, setChatContextMenu] = useState<{
    chatId: string
    x: number
    y: number
  } | null>(null)
  const storedComposeHeight = useMemo(() => readStoredComposeHeight(), [])
  const composeHeightRef = useRef(storedComposeHeight)
  const defaultComposeSize = useMemo(
    () => `${storedComposeHeight}px`,
    [storedComposeHeight],
  )
  const contacts = useContactCache()
  const {
    maintainers,
    addMaintainer,
    removeMaintainer,
    isMaintainer: isMaintainerChat,
  } = useMaintainers()
  const {
    preferences: chatLayout,
    isPinnedSectionCollapsed,
    togglePin,
    setCollapsed: setPinnedSectionCollapsed,
    isPinned,
  } = useChatListLayout(contacts.loggedInUser)

  let filteredChats = chats

  const selectedMute = selectedChat
    ? muteByChatId.get(selectedChat.id) ?? null
    : null

  const maintainerIdSet = useMemo(
    () => new Set(maintainers.map((m) => m.chatId).filter(Boolean)),
    [maintainers],
  )

  const { pinnedSection, normalSection } = useMemo(() => {
    const { pinnedSection: pinned, normalSection: normal } =
      partitionChatsForDisplay(
        filteredChats,
        maintainerIdSet,
        chatLayout.pinnedAt,
      )
    return {
      pinnedSection: sortChatsForDisplay(pinned, maintainers, chatLayout),
      normalSection: sortChatsForDisplay(normal, [], chatLayout),
    }
  }, [chatLayout, filteredChats, maintainerIdSet, maintainers])

  const chatListItemProps = useCallback(
    (chat: DriverChat) => {
      const muteEntry = muteByChatId.get(chat.id)
      const name = chatDisplayName(chat)
      return {
        showTodoBadge: isTodoMuteEntry(muteEntry),
        showMutedBadge: isMutedEntry(muteEntry),
        onMarkTodo: () => onMarkTodoChat?.(chat.id, name),
        onMarkDone: () => onMarkChatDone?.(chat.id),
        onMute: () => onMuteChat?.(chat.id, name),
        onUnmute: () => onUnmuteChat?.(chat.id),
      }
    },
    [muteByChatId, onMarkChatDone, onMarkTodoChat, onMuteChat, onUnmuteChat],
  )
  const chatListTopEstimate =
    (messageHitsLoading || messageHits.length > 0) &&
    listQuery.trim().length >= 1
      ? Math.max(1, messageHits.length) * 48 + 36
      : 0
  const pinnedEstimate =
    pinnedSection.length > 0
      ? 36 + (isPinnedSectionCollapsed ? 0 : pinnedSection.length * CHAT_ROW_ESTIMATE_PX)
      : 0
  const shouldVirtualizeChats =
    normalSection.length > CHAT_LIST_VIRTUALIZE_THRESHOLD
  const normalChatWindow = useMemo(() => {
    if (!shouldVirtualizeChats) {
      return {
        chats: normalSection,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }
    const adjustedTop = Math.max(
      0,
      chatListViewport.scrollTop - chatListTopEstimate - pinnedEstimate,
    )
    const start = Math.max(
      0,
      Math.floor(adjustedTop / CHAT_ROW_ESTIMATE_PX) - CHAT_OVERSCAN_ROWS,
    )
    const visibleCount =
      Math.ceil(chatListViewport.height / CHAT_ROW_ESTIMATE_PX) +
      CHAT_OVERSCAN_ROWS * 2
    const end = Math.min(normalSection.length, start + visibleCount)
    return {
      chats: normalSection.slice(start, end),
      topSpacer: start * CHAT_ROW_ESTIMATE_PX,
      bottomSpacer: (normalSection.length - end) * CHAT_ROW_ESTIMATE_PX,
    }
  }, [
    chatListTopEstimate,
    chatListViewport,
    normalSection,
    pinnedEstimate,
    shouldVirtualizeChats,
  ])

  const handleChatListScroll = () => {
    const el = chatListScrollRef.current
    if (!el) return
    setChatListViewport({
      scrollTop: el.scrollTop,
      height: el.clientHeight,
    })
  }

  const openChatContextMenu = useCallback(
    (chatId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      setChatContextMenu({
        chatId,
        x: event.clientX,
        y: event.clientY,
      })
    },
    [],
  )

  const contextMenuChat = chatContextMenu
    ? filteredChats.find((c) => c.id === chatContextMenu.chatId)
    : null

  async function toggleMaintainerRole(chat: DriverChat) {
    try {
      if (isMaintainerChat(chat.id)) {
        await removeMaintainer(chat.id)
      } else {
        await addMaintainer({
          chatId: chat.id,
          displayName: chatDisplayName(chat),
        })
      }
    } catch (err) {
      onComposeError?.(
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  const orderedMessages = [...messages].reverse()
  const messageRows = useMemo(
    () => buildInboxMessageRows(orderedMessages),
    [orderedMessages],
  )
  const shouldVirtualizeMessages =
    messageRows.length > MESSAGE_VIRTUALIZE_THRESHOLD &&
    pendingScrollLocalId == null
  const messageWindow = useMemo(() => {
    if (!shouldVirtualizeMessages) {
      return {
        rows: messageRows,
        start: 0,
        end: messageRows.length,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }
    const start = Math.max(
      0,
      Math.floor(messageViewport.scrollTop / MESSAGE_ROW_ESTIMATE_PX) -
        MESSAGE_OVERSCAN_ROWS,
    )
    const visibleCount =
      Math.ceil(messageViewport.height / MESSAGE_ROW_ESTIMATE_PX) +
      MESSAGE_OVERSCAN_ROWS * 2
    const end = Math.min(messageRows.length, start + visibleCount)
    return {
      rows: messageRows.slice(start, end),
      start,
      end,
      topSpacer: start * MESSAGE_ROW_ESTIMATE_PX,
      bottomSpacer: (messageRows.length - end) * MESSAGE_ROW_ESTIMATE_PX,
    }
  }, [messageRows, messageViewport, shouldVirtualizeMessages])

  useEffect(() => {
    const prevId = prevSelectedChatIdRef.current
    const el = messagesScrollRef.current
    if (
      prevId &&
      prevId !== (selectedChat?.id ?? null) &&
      el &&
      onCaptureScrollMemory
    ) {
      onCaptureScrollMemory(prevId, {
        scrollTop: el.scrollTop,
        atBottom: isNearScrollBottom(el),
      })
    }
    prevSelectedChatIdRef.current = selectedChat?.id ?? null
    setAwayFromBottom(false)
  }, [onCaptureScrollMemory, selectedChat?.id])

  useLayoutEffect(() => {
    if (scrollRestoreTop == null || messagesLoading) return
    const el = messagesScrollRef.current
    if (!el) return
    applyScrollTopWhenStable(el, scrollRestoreTop)
    onScrollRestoreApplied?.()
  }, [messagesLoading, onScrollRestoreApplied, scrollRestoreTop])

  const openInboxImageLightbox = useCallback(
    (localId: number) => {
      if (!selectedChat) return
      const gallery = buildInboxImageGallery(selectedChat.id, orderedMessages)
      if (gallery.length === 0) return
      const index = gallery.findIndex(
        (item) => item.id === `${selectedChat.id}:${localId}`,
      )
      useLightboxStore.getState().open({
        items: gallery,
        index: index >= 0 ? index : 0,
      })
    },
    [orderedMessages, selectedChat],
  )

  const handleReturnToLatest = useCallback(() => {
    scrollToBottomOnLoad.current = true
    stickToBottomRef.current = true
    setAwayFromBottom(false)
    const el = messagesScrollRef.current
    if (el) scrollToBottomReliable(el, "aggressive")
    void Promise.resolve(onReturnToLatest?.()).finally(() => {
      scrollToBottomOnLoad.current = true
      stickToBottomRef.current = true
      const target = messagesScrollRef.current
      if (target) scrollToBottomReliable(target, "aggressive")
    })
  }, [onReturnToLatest])

  useEffect(() => {
    applyChatListWidth(readStoredChatListWidth())
  }, [])

  useEffect(() => {
    if (pendingScrollLocalId != null) {
      scrollToBottomOnLoad.current = false
      stickToBottomRef.current = false
      return
    }
    if (scrollRestoreTop != null) {
      scrollToBottomOnLoad.current = false
      stickToBottomRef.current = false
      return
    }
    scrollToBottomOnLoad.current = true
    stickToBottomRef.current = true
  }, [pendingScrollLocalId, scrollRestoreTop, selectedChat?.id])

  useEffect(() => {
    if (chats.length === 0) return
    void contacts.prefetch(contactKeysFromChats(chats))
  }, [chats, contacts.prefetch])

  useEffect(() => {
    if (messages.length === 0) return
    void contacts.prefetch(
      contactKeysFromMessages(messages, [contacts.loggedInUser]),
    )
  }, [messages, contacts.loggedInUser, contacts.prefetch])

  useLayoutEffect(() => {
    const pending = pendingScrollRestore.current
    if (!pending) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = pending.sOld + (el.scrollHeight - pending.hOld)
    pendingScrollRestore.current = null
  }, [messages])

  useLayoutEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    setMessageViewport({
      scrollTop: el.scrollTop,
      height: el.clientHeight,
    })
  }, [messageRows.length, selectedChat?.id])

  useLayoutEffect(() => {
    if (pendingScrollLocalId == null || messagesLoading) return
    const el = messagesScrollRef.current
    if (!el) return
    const target = el.querySelector(
      `[data-local-id="${pendingScrollLocalId}"]`,
    )
    if (!(target instanceof HTMLElement)) {
      onClearPendingScroll?.()
      return
    }
    scrollToBottomOnLoad.current = false
    target.scrollIntoView({ block: "center" })
    setHighlightLocalId(pendingScrollLocalId)
    onClearPendingScroll?.()
    const timer = window.setTimeout(() => setHighlightLocalId(null), 2200)
    return () => window.clearTimeout(timer)
  }, [
    pendingScrollLocalId,
    orderedMessages,
    messagesLoading,
    onClearPendingScroll,
  ])

  useEffect(() => {
    if (messagesLoading || !selectedChat) return
    if (pendingScrollRestore.current) return
    if (pendingScrollLocalId != null) return
    if (scrollRestoreTop != null) return
    if (messageViewMode === "around") return
    const el = messagesScrollRef.current
    if (!el) return
    if (scrollToBottomOnLoad.current) {
      scrollToBottomReliable(el, "aggressive")
      scrollToBottomOnLoad.current = false
      stickToBottomRef.current = true
      lastScrollTopRef.current = el.scrollTop
      return
    }
    if (stickToBottomRef.current && isNearScrollBottom(el)) {
      scrollToBottomReliable(el, "gentle")
      lastScrollTopRef.current = el.scrollTop
    }
  }, [
    selectedChat?.id,
    orderedMessages,
    messagesLoading,
    pendingScrollLocalId,
    messageViewMode,
    scrollRestoreTop,
  ])

  const handleMessagesScroll = () => {
    const el = messagesScrollRef.current
    if (!el) return
    setMessageViewport({
      scrollTop: el.scrollTop,
      height: el.clientHeight,
    })

    const nearBottom = isNearScrollBottom(el)
    const scrollingUp = el.scrollTop < lastScrollTopRef.current - 2
    lastScrollTopRef.current = el.scrollTop

    if (scrollingUp) {
      stickToBottomRef.current = false
      cancelScrollToBottom(el)
    } else if (nearBottom) {
      stickToBottomRef.current = true
    }

    setAwayFromBottom(!nearBottom)
    if (
      !loadingOlder &&
      !loadingOlderRef.current &&
      hasMoreOlder &&
      onLoadOlderMessages &&
      el.scrollTop <= 80
    ) {
      pendingScrollRestore.current = {
        hOld: el.scrollHeight,
        sOld: el.scrollTop,
      }
      loadingOlderRef.current = true
      void onLoadOlderMessages().finally(() => {
        loadingOlderRef.current = false
      })
    }

    if (
      messageViewMode === "around" &&
      !loadingNewer &&
      !loadingNewerRef.current &&
      hasMoreNewer &&
      onLoadNewerMessages &&
      isNearScrollBottom(el)
    ) {
      loadingNewerRef.current = true
      void onLoadNewerMessages().finally(() => {
        loadingNewerRef.current = false
      })
    }
  }

  const shellRef = useRef<HTMLDivElement>(null)
  const storedListWidth = useMemo(() => readStoredChatListWidth(), [])
  const defaultListSize = useMemo(
    () => defaultChatListPanelSize(storedListWidth),
    [storedListWidth],
  )
  const [listPanelSizes, setListPanelSizes] = useState(() =>
    resolveChatListPanelSizes(960),
  )

  useLayoutEffect(() => {
    applyChatListWidth(storedListWidth)
  }, [storedListWidth])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return

    const syncLayout = () => {
      const width = el.getBoundingClientRect().width
      setListPanelSizes(resolveChatListPanelSizes(width))
    }

    syncLayout()
    const observer = new ResizeObserver(syncLayout)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleChatListResize = (panelSize: { inPixels: number }) => {
    applyChatListWidth(panelSize.inPixels)
  }

  const handleChatListDragEnd = () => {
    setChatListDragActive(false)
    persistChatListWidth(currentChatListWidth())
  }

  const handleComposeResize = (panelSize: { inPixels: number }) => {
    composeHeightRef.current = panelSize.inPixels
  }

  const handleComposeDragEnd = () => {
    persistComposeHeight(composeHeightRef.current)
  }

  useEffect(() => {
    if (!moreOpen) return
    const close = () => setMoreOpen(false)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [moreOpen])

  return (
    <div ref={shellRef} className="flex min-h-0 flex-1 overflow-hidden">
    <ResizablePanelGroup
      direction="horizontal"
      className="h-full min-h-0 flex-1"
    >
      <ResizablePanel
        id="inbox-chat-list"
        defaultSize={defaultListSize}
        minSize={listPanelSizes.minSize}
        maxSize={listPanelSizes.maxSize}
        groupResizeBehavior="preserve-pixel-size"
        className="flex min-h-0 min-w-0 flex-col"
        onResize={handleChatListResize}
      >
      <aside className="relative flex h-full min-w-0 flex-col border-r border-[var(--wx-border)] bg-[var(--wx-list-bg)]">
        <div className="border-b border-[var(--wx-border)] bg-[var(--wx-search-bg)] p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={listQuery}
              onChange={(e) => onListQueryChange(e.target.value)}
              placeholder={t("wechat.inbox.searchChats")}
              className="h-8 border-0 bg-[var(--wx-search-input)] pl-8 text-sm shadow-none"
            />
          </div>
        </div>
        <ul
          ref={chatListScrollRef}
          className={`min-h-0 flex-1 overflow-auto${aiPanelOpen ? " pointer-events-none" : ""}`}
          onScroll={handleChatListScroll}
        >
          {(messageHitsLoading || messageHits.length > 0) &&
            listQuery.trim().length >= 1 && (
            <li className="border-b border-[var(--wx-border)] px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("wechat.inbox.messageHits")}
              </p>
              {messageHitsLoading && messageHits.length === 0 ? (
                <p className="px-1 py-1.5 text-xs text-muted-foreground">
                  {t("wechat.inbox.searchingMessages")}
                </p>
              ) : (
              <ul className="space-y-1">
                {messageHits.map((hit) => (
                  <li key={`${hit.chat.id}-${hit.message.localId ?? hit.snippet}`}>
                    <button
                      type="button"
                      onClick={() => {
                        const localId = hit.message.localId
                        if (localId != null && onJumpToMessage) {
                          onJumpToMessage(hit.chat, localId)
                        } else {
                          onSelectChat(hit.chat)
                        }
                      }}
                      className="w-full rounded-md px-1 py-1.5 text-left text-xs hover:bg-[var(--wx-list-hover)]"
                    >
                      <span className="font-medium">
                        {chatDisplayName(hit.chat)}
                      </span>
                      <WechatEmojiText
                        text={hit.snippet}
                        emojiSize={14}
                        className="mt-0.5 block truncate text-muted-foreground"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              )}
            </li>
          )}
          {filteredChats.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {chatsLoading ? (
                t("wechat.inbox.loadingChats")
              ) : emptyListHint ? (
                <div className="space-y-3">
                  <p>{emptyListHint}</p>
                  {onEmptyListAction && emptyListActionLabel && (
                    <Button size="sm" variant="outline" onClick={onEmptyListAction}>
                      {emptyListActionLabel}
                    </Button>
                  )}
                </div>
              ) : messageHits.length > 0 ? (
                t("wechat.inbox.noChatNameHits")
              ) : (
                t("wechat.inbox.noChatsYet")
              )}
            </li>
          ) : (
            <>
              {pinnedSection.length > 0 && (
                <li className="border-b border-[var(--wx-border)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
                    onClick={() =>
                      setPinnedSectionCollapsed(!isPinnedSectionCollapsed)
                    }
                  >
                    {isPinnedSectionCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    <span>
                      {t("wechat.inbox.pinnedSection", {
                        count: pinnedSection.length,
                      })}
                    </span>
                  </button>
                  {!isPinnedSectionCollapsed && (
                    <ul>
                      {pinnedSection.map((chat) => {
                        const muteProps = chatListItemProps(chat)
                        return (
                        <ChatListItem
                          key={chat.id}
                          chat={chat}
                          isActive={selectedChat?.id === chat.id}
                          isMaintainer={isMaintainerChat(chat.id)}
                          isPinned={isPinned(chat.id)}
                          showTodoBadge={muteProps.showTodoBadge}
                          showMutedBadge={muteProps.showMutedBadge}
                          unreadCount={unreadCountsByChatId[chat.id] ?? 0}
                          onClick={() => onSelectChat(chat)}
                          onContextMenu={(e) => openChatContextMenu(chat.id, e)}
                        />
                        )
                      })}
                    </ul>
                  )}
                </li>
              )}
              {normalChatWindow.topSpacer > 0 && (
                <li
                  aria-hidden="true"
                  style={{ height: normalChatWindow.topSpacer }}
                />
              )}
              {normalChatWindow.chats.map((chat) => {
                const muteProps = chatListItemProps(chat)
                return (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  isActive={selectedChat?.id === chat.id}
                  isMaintainer={isMaintainerChat(chat.id)}
                  isPinned={false}
                  showTodoBadge={muteProps.showTodoBadge}
                  showMutedBadge={muteProps.showMutedBadge}
                  unreadCount={unreadCountsByChatId[chat.id] ?? 0}
                  onClick={() => onSelectChat(chat)}
                  onContextMenu={(e) => openChatContextMenu(chat.id, e)}
                />
                )
              })}
              {normalChatWindow.bottomSpacer > 0 && (
                <li
                  aria-hidden="true"
                  style={{ height: normalChatWindow.bottomSpacer }}
                />
              )}
            </>
          )}
        </ul>
        {chatContextMenu && contextMenuChat && (() => {
          const muteProps = chatListItemProps(contextMenuChat)
          const unread = unreadCountsByChatId[contextMenuChat.id] ?? 0
          return (
            <ChatListContextMenu
              x={chatContextMenu.x}
              y={chatContextMenu.y}
              isMaintainer={isMaintainerChat(contextMenuChat.id)}
              isPinned={isPinned(contextMenuChat.id)}
              isTodo={muteProps.showTodoBadge}
              isMuted={muteProps.showTodoBadge || muteProps.showMutedBadge}
              hasUnread={unread > 0}
              onClose={() => setChatContextMenu(null)}
              onTogglePin={() => togglePin(contextMenuChat.id)}
              onToggleMaintainer={() =>
                void toggleMaintainerRole(contextMenuChat)
              }
              onMarkTodo={muteProps.onMarkTodo}
              onMarkDone={muteProps.onMarkDone}
              onMute={muteProps.onMute}
              onUnmute={muteProps.onUnmute}
              onMarkRead={() => onMarkChatRead?.(contextMenuChat.id)}
              onMarkUnread={() => onMarkChatUnread?.(contextMenuChat.id)}
            />
          )
        })()}
        <div
          id={INBOX_AI_ASSIST_HOST_ID}
          className="inbox-ai-panel-host"
        />
      </aside>
      </ResizablePanel>

      <ResizableHandle
        withHandle={false}
        className="inbox-chat-split-handle w-px min-w-px max-w-px shrink-0 bg-[var(--wx-border)] transition-colors hover:bg-[var(--wx-accent)]/30"
        onPointerDown={() => setChatListDragActive(true)}
        onPointerUp={handleChatListDragEnd}
        onPointerCancel={handleChatListDragEnd}
      />

      <ResizablePanel
        id="inbox-chat-main"
        minSize={`${INBOX_MAIN_MIN_WIDTH}px`}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
      <main className="inbox-chat-main flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--wx-chat-bg)]">
        {!selectedChat ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <WechatChatChrome />
            <InboxChatEmptyState />
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
            <div
              id={INBOX_AI_EXPAND_HOST_ID}
              className="inbox-ai-expand-host"
            />
            <WechatChatChrome>
            <header className="inbox-chat-header z-10 flex shrink-0 items-center gap-3 bg-transparent px-4 py-2.5">
              <WeChatAvatar
                size="md"
                smallHeadUrl={selectedChat.smallHeadUrl}
                colorKey={selectedChat.id}
                letter={chatDisplayName(selectedChat)}
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-medium text-[var(--wx-text)]">
                  {chatDisplayName(selectedChat)}
                </h2>
                {selectedMute && (
                  <p className="truncate text-[11px] text-[var(--wx-muted)]">
                    {muteSummary(selectedMute, t)}
                  </p>
                )}
              </div>
              <AgentProxyToggle
                proxy={agentProxy}
                isGroup={Boolean(selectedChat.isGroup)}
                variant="topbar"
              />
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMoreOpen((v) => !v)
                  }}
                  aria-label={t("wechat.inbox.moreMenu")}
                >
                  <MoreHorizontal className="h-4 w-4 text-[var(--wx-muted)]" />
                </Button>
                {moreOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-[var(--wx-border)] bg-[var(--wechat-dark-panel)] py-1 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {selectedMute && onUnmuteChat && (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)]"
                        onClick={() => {
                          setMoreOpen(false)
                          onUnmuteChat(selectedChat.id)
                        }}
                      >
                        {t("wechat.inbox.unmute")}
                      </button>
                    )}
                    {selectedMute && onMarkChatDone && (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)]"
                        onClick={() => {
                          setMoreOpen(false)
                          onMarkChatDone(selectedChat.id)
                        }}
                      >
                        {t("wechat.inbox.markDone")}
                      </button>
                    )}
                    {!selectedChat.isGroup && (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)]"
                        onClick={() => {
                          setMoreOpen(false)
                          const username =
                            selectedChat.username?.trim() || selectedChat.id
                          navigateContactProfile(username)
                        }}
                      >
                        {t("wechat.inbox.moreViewContactCard")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)]"
                      onClick={() => {
                        setMoreOpen(false)
                        void navigator.clipboard.writeText(selectedChat.id)
                      }}
                    >
                      {t("wechat.inbox.moreCopyChatId")}
                    </button>
                  </div>
                )}
              </div>
            </header>
            </WechatChatChrome>

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                id="inbox-compose-expand-host"
                className="pointer-events-none absolute inset-0 z-10"
              />
                <ResizablePanelGroup
                  direction="vertical"
                  className="h-full min-h-0 flex-1"
                >
                <ResizablePanel
                  id="inbox-messages"
                  minSize="120px"
                  className="flex min-h-0 min-w-0 flex-col"
                >
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div
                      ref={messagesScrollRef}
                      className="inbox-messages-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
                      onScroll={handleMessagesScroll}
                    >
              {loadingOlder && (
                <p className="mb-3 text-center text-xs text-[var(--wx-muted)]">
                  {t("wechat.inbox.loadingOlderMessages")}
                </p>
              )}
              {messagesLoading ? (
                <p className="text-center text-sm text-[var(--wx-muted)]">
                  {t("wechat.inbox.loadingMessages")}
                </p>
              ) : orderedMessages.length === 0 ? (
                <p className="text-center text-sm text-[var(--wx-muted)]">
                  {t("wechat.inbox.noMessages")}
                </p>
              ) : (
                <ul className="w-full space-y-3">
                  {messageWindow.topSpacer > 0 && (
                    <li
                      aria-hidden="true"
                      style={{ height: messageWindow.topSpacer }}
                    />
                  )}
                  {messageWindow.rows.map((row) => {
                    if (row.kind === "divider" || row.kind === "system") {
                      const sysLocalId =
                        row.kind === "system" ? row.message.localId : undefined
                      const highlighted =
                        sysLocalId != null && highlightLocalId === sysLocalId
                      return (
                        <li
                          key={row.key}
                          className="inbox-time-divider"
                          data-local-id={sysLocalId}
                        >
                          <span className={highlighted ? "wx-message-highlight" : undefined}>
                            {row.label}
                          </span>
                        </li>
                      )
                    }

                    const m = row.message
                    const i = row.index
                    const body = messageDisplayBody(m, t)
                    const mediaOnly = isMediaMessage(m)
                    const self = Boolean(m.isSelf)
                    const isPending = Boolean(m.pending)
                    const isGroup = Boolean(selectedChat.isGroup)
                    const peerContact = !self && m.sender
                      ? contacts.getContact(m.sender)
                      : undefined
                    const avatarUrl = self
                      ? contacts.loggedInContact?.smallHeadUrl
                      : isGroup
                        ? peerContact?.smallHeadUrl
                        : selectedChat.smallHeadUrl ?? peerContact?.smallHeadUrl
                    const avatarKey = self
                      ? contacts.loggedInUser ?? selectedChat.id
                      : m.sender ?? selectedChat.id
                    const avatarLetter = self
                      ? contacts.loggedInDisplayName ??
                        t("wechat.inbox.bubbleSelf")
                      : isGroup
                        ? m.senderName ??
                          (peerContact
                            ? contacts.contactDisplayName(peerContact)
                            : t("wechat.inbox.msgOther"))
                        : chatDisplayName(selectedChat)
                    const displayName = self
                      ? contacts.loggedInDisplayName ??
                        t("wechat.inbox.bubbleSelf")
                      : isGroup
                        ? m.senderName ??
                          (peerContact
                            ? contacts.contactDisplayName(peerContact)
                            : m.sender ?? "")
                        : chatDisplayName(selectedChat)
                    const timeLabel = m.timestamp
                      ? formatMessageTime(m.timestamp)
                      : ""
                    const metaLabel = self
                      ? agentProxy.agentProxyEnabled
                        ? `${t("wechat.inbox.bubbleAuto")}${timeLabel ? ` · ${timeLabel}` : ""}`
                        : `${t("wechat.inbox.bubbleSelf")}${timeLabel ? ` · ${timeLabel}` : ""}`
                      : timeLabel

                    return (
                      <li
                        key={m.clientMsgId ?? m.localId ?? i}
                        data-local-id={m.pending ? undefined : m.localId}
                        data-client-msg-id={m.clientMsgId}
                        className={`flex w-full items-start gap-2 ${self ? "flex-row-reverse" : ""}${
                          highlightLocalId === m.localId && mediaOnly
                            ? " wx-message-highlight-media"
                            : ""
                        }${isPending ? " opacity-70" : ""}`}
                      >
                        <WeChatAvatar
                          size="md"
                          smallHeadUrl={avatarUrl}
                          colorKey={avatarKey}
                          letter={avatarLetter}
                        />
                        <div
                          className={`flex w-fit max-w-[85%] flex-col gap-0.5 ${self ? "items-end" : "items-start"}`}
                        >
                          {isGroup && !self && displayName && (
                            <span className="px-1 text-[11px] text-[var(--wx-muted)]">
                              {displayName}
                            </span>
                          )}
                          <div
                            className={`w-fit max-w-full overflow-hidden text-sm leading-relaxed ${
                              mediaOnly
                                ? "rounded-none border-0 bg-transparent p-0"
                                : `rounded px-3 py-2 ${
                                    self
                                      ? "bg-[var(--wx-bubble-self)] text-[var(--wx-bubble-self-text)]"
                                      : "border border-[var(--wx-bubble-other-border)] bg-[var(--wx-bubble-other)] text-[var(--wx-bubble-other-text)]"
                                  }${
                                    highlightLocalId === m.localId
                                      ? " wx-message-highlight"
                                      : ""
                                  }`
                            }`}
                          >
                            {mediaOnly && selectedChat ? (
                              <InboxMessageMedia
                                chatId={selectedChat.id}
                                message={m}
                                fallbackLabel={body}
                                isSelf={self}
                                onImageClick={openInboxImageLightbox}
                              />
                            ) : (
                              <WechatEmojiText
                                text={body}
                                emojiSize={20}
                                className="whitespace-pre-wrap break-words"
                              />
                            )}
                            {metaLabel && !mediaOnly && (
                              <span
                                className={`mt-1 block text-[10px] ${
                                  self
                                    ? "text-[var(--wx-bubble-self-meta)]"
                                    : "text-[var(--wx-bubble-other-meta)]"
                                }`}
                              >
                                {metaLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                  {messageWindow.bottomSpacer > 0 && (
                    <li
                      aria-hidden="true"
                      style={{ height: messageWindow.bottomSpacer }}
                    />
                  )}
                </ul>
              )}
              {loadingNewer && (
                <p className="mt-3 text-center text-xs text-[var(--wx-muted)]">
                  {t("wechat.inbox.loadingNewerMessages")}
                </p>
              )}
                    </div>
                    {awayFromBottom && onReturnToLatest && (
                      <button
                        type="button"
                        className="absolute bottom-3 right-4 z-20 flex items-center gap-1 rounded-full border border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-3 py-1.5 text-xs text-[var(--wx-accent)] shadow-md transition-colors hover:bg-[var(--wx-list-hover)]"
                        aria-label={t("wechat.inbox.returnToLatest")}
                        title={t("wechat.inbox.returnToLatest")}
                        onClick={handleReturnToLatest}
                      >
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        <span>{t("wechat.inbox.returnToLatest")}</span>
                      </button>
                    )}
                  </div>
                </ResizablePanel>

                <ResizableHandle
                  withHandle={false}
                  className="inbox-compose-split-handle shrink-0"
                  onPointerUp={handleComposeDragEnd}
                  onPointerCancel={handleComposeDragEnd}
                />

                <ResizablePanel
                  id="inbox-compose"
                  defaultSize={defaultComposeSize}
                  minSize={`${MIN_COMPOSE_HEIGHT}px`}
                  maxSize={`${MAX_COMPOSE_HEIGHT}px`}
                  groupResizeBehavior="preserve-pixel-size"
                  className="flex min-h-0 min-w-0 flex-col"
                  onResize={handleComposeResize}
                >
                  <InboxComposeBar
                    chat={selectedChat}
                    agentProxyEnabled={agentProxy.agentProxyEnabled}
                    agentProxyBusy={agentProxy.busy}
                    onBeforeSend={onBeforeSend}
                    onSendFailed={onSendFailed}
                    onSent={() => onRefreshMessages(selectedChat.id)}
                    onError={onComposeError}
                    onJumpToMessage={
                      onJumpToMessage
                        ? (localId) => onJumpToMessage(selectedChat, localId)
                        : undefined
                    }
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        )}
      </main>
      </ResizablePanel>
    </ResizablePanelGroup>
    <InboxAiAssistOverlay />
    </div>
  )
}
