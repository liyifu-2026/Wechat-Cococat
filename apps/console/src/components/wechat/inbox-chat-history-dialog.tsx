import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { ImageIcon, Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { WeChatAvatar } from "@/components/console/wechat-avatar"
import type { DriverChat, DriverMessage } from "@/lib/driver-client"
import { WechatEmojiText } from "@/components/console/wechat-emoji-text"
import { messageDisplayBody } from "@/lib/wechat-message-body"
import { chatDisplayName, formatMessageTime } from "@/lib/wechat-ui"
import {
  type HistoryTab,
  matchesHistoryTab,
} from "@/lib/inbox-chat-history"
import { useChatHistory } from "@/hooks/use-chat-history"
import { useContactCache } from "@/hooks/use-contact-cache"
import { useWechatDialogPortal } from "@/hooks/use-wechat-dialog-portal"
import {
  mediaDataUrl,
  pruneMediaCacheForChat,
  useMessageMedia,
} from "@/hooks/use-message-media-cache"
import {
  pruneVoiceTranscriptCacheForChat,
  useVoiceTranscript,
} from "@/hooks/use-voice-transcript"

type InboxChatHistoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  chat: DriverChat
  onJumpToMessage: (localId: number) => void
}

const TABS: { id: HistoryTab; labelKey: string }[] = [
  { id: "all", labelKey: "wechat.inbox.historyTabAll" },
  { id: "image", labelKey: "wechat.inbox.historyTabImages" },
  { id: "voice", labelKey: "wechat.inbox.historyTabVoice" },
]

function HistorySenderMeta({
  chat,
  message,
}: {
  chat: DriverChat
  message: DriverMessage
}) {
  const { t } = useTranslation()
  const contacts = useContactCache()
  const isGroup = Boolean(chat.isGroup)
  const self = Boolean(message.isSelf)
  const timeLabel = message.timestamp
    ? formatMessageTime(message.timestamp)
    : ""

  let avatarUrl: string | undefined
  let colorKey: string
  let letter: string
  let displayName: string

  if (self) {
    avatarUrl = contacts.loggedInContact?.smallHeadUrl
    colorKey = contacts.loggedInUser ?? chat.id
    displayName =
      contacts.loggedInDisplayName ?? t("wechat.inbox.bubbleSelf")
    letter = displayName
  } else if (isGroup && message.sender) {
    const peer = contacts.getContact(message.sender)
    avatarUrl = peer?.smallHeadUrl
    colorKey = message.sender
    displayName =
      message.senderName ??
      (peer ? contacts.contactDisplayName(peer) : t("wechat.inbox.msgOther"))
    letter = displayName
  } else {
    avatarUrl = chat.smallHeadUrl
    colorKey = chat.id
    displayName = chatDisplayName(chat)
    letter = displayName
  }

  return (
    <div className="flex items-center gap-2">
      <WeChatAvatar
        size="sm"
        smallHeadUrl={avatarUrl}
        colorKey={colorKey}
        letter={letter}
      />
      <span className="min-w-0 truncate text-xs font-medium text-[var(--wx-text)]">
        {displayName}
      </span>
      {timeLabel && (
        <span className="ml-auto shrink-0 text-[11px] text-[var(--wx-muted)]">
          {timeLabel}
        </span>
      )}
    </div>
  )
}

function HistoryImagePreview({
  chatId,
  message,
  className = "",
}: {
  chatId: string
  message: DriverMessage
  className?: string
}) {
  const { t } = useTranslation()
  const { media, loading } = useMessageMedia(chatId, message.localId, true)
  const src = media ? mediaDataUrl(media) : null
  const label = messageDisplayBody(message, t)

  return (
    <div
      className={`overflow-hidden bg-[var(--wx-media-placeholder)] ${className}`}
      title={label}
    >
      {src ? (
        <img
          src={src}
          alt={label}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[var(--wx-muted)]">
          {loading ? "…" : <ImageIcon className="h-5 w-5" />}
        </span>
      )}
    </div>
  )
}

function HistoryImageThumb({
  chatId,
  chat,
  message,
  onClick,
}: {
  chatId: string
  chat: DriverChat
  message: DriverMessage
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2 overflow-hidden rounded-lg border border-[var(--wx-border)] bg-[var(--wx-search-input)] p-2 text-left transition hover:bg-[var(--wx-list-hover)]"
    >
      <HistorySenderMeta chat={chat} message={message} />
      <div className="aspect-square overflow-hidden rounded-md shadow-sm ring-1 ring-black/5 dark:ring-white/5">
        <HistoryImagePreview
          chatId={chatId}
          message={message}
          className="h-full w-full"
        />
      </div>
    </button>
  )
}

function HistoryVoiceRow({
  chat,
  message,
  onClick,
}: {
  chat: DriverChat
  message: DriverMessage
  onClick: () => void
}) {
  const { t } = useTranslation()
  const { media, loading } = useMessageMedia(
    chat.id,
    message.localId,
    message.mediaKind === "voice",
  )
  const src = media?.type === "voice" ? mediaDataUrl(media) : null
  const { state, transcribe } = useVoiceTranscript(chat.id, message.localId)

  const handleTranscribe = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      if (!src) return
      void transcribe(src)
    },
    [src, transcribe],
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border border-[var(--wx-border)] bg-[var(--wx-search-input)] p-3 text-left transition hover:bg-[var(--wx-list-hover)]"
    >
      <HistorySenderMeta chat={chat} message={message} />
      {src ? (
        <audio
          controls
          preload="metadata"
          className="max-w-full"
          src={src}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-sm text-[var(--wx-muted)]">
          {loading
            ? t("wechat.inbox.loadingMessages")
            : t("wechat.inbox.mediaVoice")}
        </span>
      )}
      {src && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-[var(--wx-accent)] hover:underline disabled:opacity-50"
            disabled={state.status === "loading"}
            onClick={handleTranscribe}
          >
            {state.status === "loading"
              ? t("wechat.inbox.voiceTranscribing")
              : t("wechat.inbox.voiceTranscribe")}
          </button>
        </div>
      )}
      {(state.status === "done" || state.status === "error") && (
        <p className="whitespace-pre-wrap break-words text-xs text-[var(--wx-text)]">
          {state.status === "done"
            ? state.text
            : t("wechat.inbox.voiceTranscribeFailed")}
        </p>
      )}
    </button>
  )
}

function HistoryAllRow({
  chat,
  message,
  onClick,
}: {
  chat: DriverChat
  message: DriverMessage
  onClick: () => void
}) {
  const { t } = useTranslation()
  const body = messageDisplayBody(message, t)
  const isImage =
    message.mediaKind === "image" || message.mediaKind === "emoji"

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-[var(--wx-border)] bg-[var(--wx-search-input)] p-3 text-left transition hover:bg-[var(--wx-list-hover)]"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <HistorySenderMeta chat={chat} message={message} />
        <div className="flex items-start gap-3">
          {isImage && (
            <HistoryImagePreview
              chatId={chat.id}
              message={message}
              className="h-12 w-12 shrink-0 rounded-md"
            />
          )}
          <WechatEmojiText
            text={body}
            emojiSize={16}
            className="line-clamp-3 min-w-0 flex-1 text-sm text-[var(--wx-text)]"
          />
        </div>
      </div>
    </button>
  )
}

export function InboxChatHistoryDialog({
  open,
  onOpenChange,
  chat,
  onJumpToMessage,
}: InboxChatHistoryDialogProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const portalContainer = useWechatDialogPortal(open)
  const [searchQuery, setSearchQuery] = useState("")
  const { tab, setTab, items, loading, loadingMore, exhausted, loadMore } =
    useChatHistory(chat.id, open)

  useEffect(() => {
    if (open) return
    setSearchQuery("")
    pruneMediaCacheForChat(chat.id)
    pruneVoiceTranscriptCacheForChat(chat.id)
  }, [open, chat.id])

  useEffect(() => {
    setSearchQuery("")
  }, [chat.id])

  const handlePick = useCallback(
    (localId: number) => {
      onOpenChange(false)
      onJumpToMessage(localId)
    },
    [onJumpToMessage, onOpenChange],
  )

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loading || loadingMore || exhausted) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      loadMore()
    }
  }, [exhausted, loadMore, loading, loadingMore])

  const filtered = items
    .filter((m) => matchesHistoryTab(m, tab))
    .filter((m) => {
      const q = searchQuery.trim().toLowerCase()
      if (!q) return true
      return messageDisplayBody(m, t).toLowerCase().includes(q)
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        opaqueOverlay
        portalContainer={portalContainer}
        overlayClassName="bg-black/70 backdrop-blur-none"
        className="flex max-h-[min(640px,85vh)] w-full max-w-lg flex-col gap-0 overflow-hidden border-[var(--wx-border)] !bg-[var(--wx-header-bg)] p-0 text-[var(--wx-text)] shadow-2xl sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader className="border-b border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-4 py-3">
          <DialogTitle className="text-base font-medium">
            {t("wechat.inbox.historyTitle")}
          </DialogTitle>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--wx-muted)]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("wechat.inbox.searchMessages")}
              className="h-8 border-[var(--wx-border)] bg-[var(--wx-search-input)] pl-8 text-sm text-[var(--wx-text)]"
            />
          </div>
        </DialogHeader>

        <div className="flex gap-1 border-b border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-3 py-2">
          {TABS.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                tab === id
                  ? "bg-[var(--wx-accent)] text-white"
                  : "text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-[var(--wx-header-bg)] px-3 py-3"
        >
          {loading && filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--wx-muted)]">
              {t("wechat.inbox.loadingMessages")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--wx-muted)]">
              {searchQuery.trim()
                ? t("wechat.inbox.noSearchResults")
                : t("wechat.inbox.historyEmpty")}
            </p>
          ) : tab === "image" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map((m) => (
                <HistoryImageThumb
                  key={m.localId}
                  chatId={chat.id}
                  chat={chat}
                  message={m}
                  onClick={() => handlePick(m.localId)}
                />
              ))}
            </div>
          ) : tab === "voice" ? (
            <ul className="space-y-2">
              {filtered.map((m) => (
                <li key={m.localId}>
                  <HistoryVoiceRow
                    chat={chat}
                    message={m}
                    onClick={() => handlePick(m.localId)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {filtered.map((m) => (
                <li key={m.localId}>
                  <HistoryAllRow
                    chat={chat}
                    message={m}
                    onClick={() => handlePick(m.localId)}
                  />
                </li>
              ))}
            </ul>
          )}

          {loadingMore && (
            <p className="py-3 text-center text-xs text-[var(--wx-muted)]">
              {t("wechat.inbox.loadingOlderMessages")}
            </p>
          )}
          {!loading && !loadingMore && exhausted && filtered.length > 0 && (
            <p className="py-3 text-center text-[11px] text-[var(--wx-muted)]">
              {t("wechat.inbox.historyEnd")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
