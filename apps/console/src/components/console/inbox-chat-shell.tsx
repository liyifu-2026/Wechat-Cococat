import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DriverChat, DriverMessage } from "@/lib/driver-client"
import type { CrossChatMessageHit } from "@/lib/unified-inbox-search"
import type { InboxListFilter } from "@/lib/console-layout"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import { InboxContextPanel } from "@/components/console/inbox-context-panel"
import type { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import {
  chatAvatarClass,
  chatAvatarLetter,
  chatDisplayName,
  highlightText,
} from "@/lib/wechat-ui"
import { useConsoleStore } from "@/stores/console-store"

export type { InboxListFilter }

interface InboxChatShellProps {
  chats: DriverChat[]
  chatsLoading?: boolean
  messageHits?: CrossChatMessageHit[]
  selectedChat: DriverChat | null
  messages: DriverMessage[]
  messagesLoading: boolean
  listQuery: string
  onListQueryChange: (value: string) => void
  messageQuery: string
  onMessageQueryChange: (value: string) => void
  onSelectChat: (chat: DriverChat) => void
  listFilter: InboxListFilter
  onListFilterChange: (filter: InboxListFilter) => void
  muteByChatId: Map<string, EscalationMuteEntry>
  todoCount: number
  muteBusyChatId?: string | null
  onUnmuteChat?: (chatId: string) => void
  onMarkChatDone?: (chatId: string) => void
  session: ReturnType<typeof useInboxSessionContext>
  /** Shown when chat list is empty but services appear up (e.g. DB keys missing). */
  emptyListHint?: string
  onEmptyListAction?: () => void
  emptyListActionLabel?: string
}

function messageBody(m: DriverMessage): string {
  return m.content?.trim() || `(${m.type ?? "media"})`
}

function muteTag(
  entry: EscalationMuteEntry | undefined,
  t: (key: string) => string,
): string | null {
  if (!entry) return null
  if (entry.reason === "escalate_a" || entry.reason === "escalate") {
    return t("console.inbox.tagA")
  }
  if (entry.reason === "probe_b" || entry.reason === "probe_loop") {
    return t("console.inbox.tagB")
  }
  return t("console.inbox.tagMute")
}

export function InboxChatShell({
  chats,
  chatsLoading = false,
  messageHits = [],
  selectedChat,
  messages,
  messagesLoading,
  listQuery,
  onListQueryChange,
  messageQuery,
  onMessageQueryChange,
  onSelectChat,
  listFilter,
  onListFilterChange,
  muteByChatId,
  todoCount,
  muteBusyChatId = null,
  onUnmuteChat,
  onMarkChatDone,
  session,
  emptyListHint,
  onEmptyListAction,
  emptyListActionLabel,
}: InboxChatShellProps) {
  const { t } = useTranslation()
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  let filteredChats = chats

  if (listFilter === "todo" || listFilter === "mute") {
    filteredChats = filteredChats.filter((c) => muteByChatId.has(c.id))
  }

  const selectedMute = selectedChat
    ? muteByChatId.get(selectedChat.id) ?? null
    : null

  const msgQ = messageQuery.trim().toLowerCase()
  const filteredMessages = msgQ
    ? messages.filter((m) => messageBody(m).toLowerCase().includes(msgQ))
    : messages

  const orderedMessages = [...filteredMessages].reverse()

  useEffect(() => {
    if (messagesLoading || !selectedChat) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [selectedChat?.id, orderedMessages, messagesLoading])

  useEffect(() => {
    if (!moreOpen) return
    const close = () => setMoreOpen(false)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [moreOpen])

  const hintText = selectedMute
    ? selectedMute.reason === "escalate_a" || selectedMute.reason === "escalate"
      ? t("console.inbox.hintEscalateA", {
          name: selectedChat ? chatDisplayName(selectedChat) : "",
        })
      : t("console.inbox.hintProbeB")
    : selectedChat
      ? t("console.inbox.hintNormal")
      : null

  return (
    <div className="inbox-shell flex min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--wx-border)]">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--wx-border)] bg-[var(--wx-list-bg)]">
        <div className="flex gap-1 border-b border-[var(--wx-border)] px-2 py-2">
          {(
            [
              ["all", t("console.inbox.filterAll")],
              ["todo", t("console.inbox.filterTodo", { count: todoCount })],
              ["mute", t("console.inbox.filterMute")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onListFilterChange(id)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                listFilter === id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="border-b border-[var(--wx-border)] bg-[var(--wx-search-bg)] p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={listQuery}
              onChange={(e) => onListQueryChange(e.target.value)}
              placeholder={t("console.inbox.searchChats")}
              className="h-8 border-0 bg-[var(--wx-search-input)] pl-8 text-sm shadow-none"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {listQuery.trim().length >= 2 && messageHits.length > 0 && (
            <li className="border-b border-[var(--wx-border)] px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("console.inbox.messageHits")}
              </p>
              <ul className="space-y-1">
                {messageHits.map((hit) => (
                  <li key={`${hit.chat.id}-${hit.message.localId ?? hit.snippet}`}>
                    <button
                      type="button"
                      onClick={() => onSelectChat(hit.chat)}
                      className="w-full rounded-md px-1 py-1.5 text-left text-xs hover:bg-[var(--wx-list-hover)]"
                    >
                      <span className="font-medium">
                        {chatDisplayName(hit.chat)}
                      </span>
                      <span className="mt-0.5 block truncate text-muted-foreground">
                        {hit.snippet}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )}
          {filteredChats.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {chatsLoading ? (
                t("console.inbox.loadingChats")
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
                t("console.inbox.noChatNameHits")
              ) : (
                t("console.inbox.noChatsYet")
              )}
            </li>
          ) : (
            filteredChats.map((chat) => {
              const active = selectedChat?.id === chat.id
              const mute = muteByChatId.get(chat.id)
              const tag = muteTag(mute, t)
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat)}
                    className={`flex w-full gap-2.5 border-b border-[var(--wx-border)] px-3 py-3 text-left transition-colors hover:bg-[var(--wx-list-hover)] ${
                      active ? "bg-[var(--wx-list-active)]" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded text-sm font-semibold text-white ${chatAvatarClass(chat.id)}`}
                    >
                      {chatAvatarLetter(chat)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[var(--wx-text)]">
                          {chatDisplayName(chat)}
                        </span>
                        {tag && (
                          <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                            {tag}
                          </span>
                        )}
                      </span>
                      {chat.lastMessagePreview && (
                        <span className="mt-0.5 block truncate text-xs text-[var(--wx-muted)]">
                          {chat.lastMessagePreview}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--wx-chat-bg)]">
        {!selectedChat ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("console.wechat.selectChat")}
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-4 py-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded text-sm font-semibold text-white ${chatAvatarClass(selectedChat.id)}`}
              >
                {chatAvatarLetter(selectedChat)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-medium text-[var(--wx-text)]">
                  {chatDisplayName(selectedChat)}
                </h2>
                {selectedMute && (
                  <p className="truncate text-xs text-muted-foreground">
                    {muteTag(selectedMute, t)} ·{" "}
                    {t("console.inbox.muteRemaining", {
                      hours: Math.max(
                        0,
                        Math.ceil(
                          (selectedMute.muted_until - Date.now()) /
                            (60 * 60 * 1000),
                        ),
                      ),
                    })}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => navigateBrain("routing")}
              >
                {t("console.inbox.routing")}
              </Button>
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMoreOpen((v) => !v)
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                {moreOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-md border bg-popover py-1 shadow-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        setMoreOpen(false)
                        navigateSystemWechat(true)
                      }}
                    >
                      {t("console.inbox.moreWechatConnect")}
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        setMoreOpen(false)
                        void navigator.clipboard.writeText(selectedChat.id)
                      }}
                    >
                      {t("console.inbox.moreCopyChatId")}
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        setMoreOpen(false)
                        navigateBrain("kb")
                      }}
                    >
                      {t("console.inbox.moreEditKb")}
                    </button>
                  </div>
                )}
              </div>
            </header>

            {hintText && (
              <div
                className={`shrink-0 border-b px-4 py-2.5 text-xs ${
                  selectedMute
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {hintText}
              </div>
            )}

            <div className="border-b border-[var(--wx-border)] bg-[var(--wx-search-bg)] px-4 py-2">
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={messageQuery}
                  onChange={(e) => onMessageQueryChange(e.target.value)}
                  placeholder={t("console.wechat.searchMessages")}
                  className="h-8 border-0 bg-[var(--wx-search-input)] pl-8 text-sm shadow-none"
                />
              </div>
            </div>

            <div
              ref={messagesScrollRef}
              className="min-h-0 flex-1 overflow-auto px-4 py-4"
            >
              {messagesLoading ? (
                <p className="text-center text-sm text-muted-foreground">
                  {t("console.wechat.loadingMessages")}
                </p>
              ) : orderedMessages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  {msgQ
                    ? t("console.wechat.noSearchResults")
                    : t("console.wechat.noMessages")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {orderedMessages.map((m, i) => {
                    const body = messageBody(m)
                    const self = Boolean(m.isSelf)
                    return (
                      <li
                        key={`${m.localId ?? i}`}
                        className={`flex items-start gap-2 ${self ? "flex-row-reverse" : ""}`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded text-xs font-medium ${
                            self
                              ? "bg-[var(--wx-avatar-self)] text-[var(--wx-bubble-self-text)]"
                              : "bg-[var(--wx-avatar-other)] text-white"
                          }`}
                        >
                          {self
                            ? t("console.inbox.avatarAuto").slice(0, 1)
                            : t("console.wechat.msgOther").slice(0, 1)}
                        </span>
                        <div
                          className={`max-w-[min(72%,28rem)] rounded px-3 py-2 text-sm leading-relaxed ${
                            self
                              ? "bg-[var(--wx-bubble-self)] text-[var(--wx-bubble-self-text)]"
                              : "border border-[var(--wx-bubble-other-border)] bg-[var(--wx-bubble-other)] text-[var(--wx-bubble-other-text)]"
                          }`}
                        >
                          {msgQ ? (
                            <span
                              className="whitespace-pre-wrap break-words"
                              dangerouslySetInnerHTML={{
                                __html: highlightText(body, messageQuery),
                              }}
                            />
                          ) : (
                            <span className="whitespace-pre-wrap break-words">
                              {body}
                            </span>
                          )}
                          {m.timestamp && (
                            <span
                              className={`mt-1 block text-[10px] ${
                                self
                                  ? "text-[var(--wx-bubble-self-meta)]"
                                  : "text-[var(--wx-bubble-other-meta)]"
                              }`}
                            >
                              {self
                                ? `${t("console.inbox.bubbleAuto")} · ${m.timestamp}`
                                : m.timestamp}
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <footer className="shrink-0 border-t border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-4 py-3 text-center text-xs text-muted-foreground">
              {t("console.inbox.readonlyFooter")}
            </footer>
          </>
        )}
      </main>

      <InboxContextPanel
        chat={selectedChat}
        muteEntry={selectedMute}
        session={session}
        muteBusy={
          Boolean(selectedChat && muteBusyChatId === selectedChat.id)
        }
        onUnmute={
          selectedChat && selectedMute && onUnmuteChat
            ? () => onUnmuteChat(selectedChat.id)
            : undefined
        }
        onMarkDone={
          selectedChat && selectedMute && onMarkChatDone
            ? () => onMarkChatDone(selectedChat.id)
            : undefined
        }
        onEditRouting={
          selectedMute &&
          (selectedMute.reason === "escalate_a" ||
            selectedMute.reason === "escalate")
            ? () => navigateBrain("routing")
            : undefined
        }
      />
    </div>
  )
}
