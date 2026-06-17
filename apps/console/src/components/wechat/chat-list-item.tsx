import type { MouseEvent } from "react"
import { BellOff, Shield, Timer } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { DriverChat } from "@/lib/driver-client"
import { WeChatAvatar } from "@/components/console/wechat-avatar"
import { WechatEmojiText } from "@/components/console/wechat-emoji-text"
import { chatDisplayName, formatMessageTime } from "@/lib/wechat-ui"

export type ChatListItemProps = {
  chat: DriverChat
  isActive: boolean
  isMaintainer: boolean
  isPinned: boolean
  showTodoBadge?: boolean
  showMutedBadge?: boolean
  onClick: () => void
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
}

export function ChatListItem({
  chat,
  isActive,
  isMaintainer,
  isPinned,
  showTodoBadge = false,
  showMutedBadge = false,
  onClick,
  onContextMenu,
}: ChatListItemProps) {
  const { t } = useTranslation()

  let rowClass =
    "flex w-full gap-2.5 border-b border-[var(--wx-border)] px-3 py-3 text-left transition-colors hover:bg-[var(--wx-list-hover)]"
  if (isActive) {
    rowClass += " bg-[var(--wx-list-active)]"
  } else if (isMaintainer) {
    rowClass += " bg-[var(--wx-maintainer-row)] hover:bg-[var(--wx-maintainer-row-hover)]"
  } else if (isPinned) {
    rowClass += " bg-[var(--wx-pinned-row)] hover:bg-[var(--wx-pinned-row-hover)]"
  }

  const timeLabel = chat.lastActivityAt
    ? formatMessageTime(chat.lastActivityAt)
    : null

  return (
    <li className="relative">
      <button
        type="button"
        className={rowClass}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e)
        }}
      >
        <WeChatAvatar
          size="list"
          smallHeadUrl={chat.smallHeadUrl}
          colorKey={chat.id}
          letter={chatDisplayName(chat)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-[var(--wx-text)]">
              <span className="truncate">{chatDisplayName(chat)}</span>
              {isMaintainer && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--wx-accent)]/40 bg-[var(--wx-accent)]/10 px-1 py-0.5 text-[10px] font-normal leading-none text-[var(--wx-accent)]">
                  <Shield className="h-2.5 w-2.5" aria-hidden />
                  {t("wechat.inbox.maintainerBadge")}
                </span>
              )}
              {showTodoBadge && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[10px] font-normal leading-none text-amber-700 dark:text-amber-300">
                  <Timer className="h-2.5 w-2.5" aria-hidden />
                  {t("wechat.inbox.badgeTodo")}
                </span>
              )}
              {showMutedBadge && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-1 py-0.5 text-[10px] font-normal leading-none text-[var(--wx-muted)]">
                  <BellOff className="h-2.5 w-2.5" aria-hidden />
                  {t("wechat.inbox.badgeMuted")}
                </span>
              )}
            </span>
            {timeLabel ? (
              <span className="shrink-0 text-[10px] text-[var(--wx-muted)]">
                {timeLabel}
              </span>
            ) : null}
          </span>
          {chat.lastMessagePreview && (
            <WechatEmojiText
              text={chat.lastMessagePreview}
              emojiSize={14}
              className="mt-0.5 block truncate text-xs text-[var(--wx-muted)]"
            />
          )}
        </span>
      </button>
    </li>
  )
}
