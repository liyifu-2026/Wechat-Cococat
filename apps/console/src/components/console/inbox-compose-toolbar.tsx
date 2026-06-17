import { Clock, FolderOpen, Image, Smile } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

type InboxComposeToolbarProps = {
  disabled?: boolean
  emojiActive?: boolean
  emojiButtonRef?: React.RefObject<HTMLButtonElement | null>
  onToggleEmoji?: () => void
  onUnavailable?: () => void
  onOpenHistory?: () => void
  historyDisabled?: boolean
}

const TOOLBAR_ITEMS = [
  { id: "image", icon: Image },
  { id: "file", icon: FolderOpen },
] as const

export function InboxComposeToolbar({
  disabled = false,
  emojiActive = false,
  emojiButtonRef,
  onToggleEmoji,
  onUnavailable,
  onOpenHistory,
  historyDisabled = false,
}: InboxComposeToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
      <button
        ref={emojiButtonRef}
        type="button"
        disabled={disabled}
        title={t("wechat.inbox.composeEmoji")}
        aria-label={t("wechat.inbox.composeEmoji")}
        aria-pressed={emojiActive}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)] disabled:cursor-not-allowed disabled:opacity-40",
          emojiActive && "bg-[var(--wx-list-hover)] text-[var(--wx-accent)]",
        )}
        onClick={() => {
          if (disabled) return
          onToggleEmoji?.()
        }}
      >
        <Smile className="h-4 w-4" />
      </button>
      {TOOLBAR_ITEMS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          title={t("wechat.inbox.composeToolbarSoon")}
          aria-label={t("wechat.inbox.composeToolbarSoon")}
          className="flex h-8 w-8 items-center justify-center rounded text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (disabled) return
            onUnavailable?.()
          }}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      {onOpenHistory && (
        <button
          type="button"
          disabled={historyDisabled}
          title={t("wechat.inbox.historyTitle")}
          aria-label={t("wechat.inbox.historyTitle")}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (historyDisabled) return
            onOpenHistory()
          }}
        >
          <Clock className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
