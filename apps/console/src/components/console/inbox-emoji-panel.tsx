import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { emojiMap, type WechatEmoji, wechatEmojis } from "wechat-emoji-renderer"
import { INBOX_KAOMOJI } from "@/lib/inbox-kaomoji"
import {
  readRecentEmojiCodes,
  recordRecentEmojiCode,
} from "@/lib/inbox-recent-emojis"
import { wechatEmojiInlineStyle } from "@/lib/wechat-emoji-config"
import { cn } from "@/lib/utils"

type InboxEmojiPanelProps = {
  open?: boolean
  onInsert: (text: string) => void
  className?: string
}

type EmojiTab = "wechat" | "kaomoji"

const PICKER_EMOJI_HEIGHT = 28

function WechatEmojiButton({
  emoji,
  onSelect,
}: {
  emoji: WechatEmoji
  onSelect: (emoji: WechatEmoji) => void
}) {
  return (
    <button
      type="button"
      className="emoji-item flex items-center justify-center overflow-visible rounded border-0 bg-transparent p-0.5 transition-colors hover:bg-[var(--wx-list-hover)]"
      title={emoji.name}
      aria-label={emoji.name}
      onClick={() => onSelect(emoji)}
    >
      <span
        className="wechat-emoji shrink-0"
        style={wechatEmojiInlineStyle(emoji.position, PICKER_EMOJI_HEIGHT)}
      />
    </button>
  )
}

function WechatEmojiGrid({
  emojis,
  onSelect,
}: {
  emojis: WechatEmoji[]
  onSelect: (emoji: WechatEmoji) => void
}) {
  if (emojis.length === 0) return null
  return (
    <div className="inbox-wechat-emoji-picker grid grid-cols-9 gap-0.5 p-1">
      {emojis.map((emoji) => (
        <WechatEmojiButton key={emoji.code} emoji={emoji} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function InboxEmojiPanel({
  open = true,
  onInsert,
  className,
}: InboxEmojiPanelProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<EmojiTab>("wechat")
  const [recentCodes, setRecentCodes] = useState<string[]>(() =>
    readRecentEmojiCodes(),
  )

  useEffect(() => {
    if (open) setRecentCodes(readRecentEmojiCodes())
  }, [open])

  const handleWechatEmoji = (emoji: WechatEmoji) => {
    setRecentCodes(recordRecentEmojiCode(emoji.code))
    onInsert(emoji.code)
  }

  const recentEmojis = recentCodes
    .map((code) => emojiMap.get(code))
    .filter((e): e is WechatEmoji => e != null)

  return (
    <div
      className={cn(
        "flex min-h-0 shrink-0 flex-col bg-transparent",
        className,
      )}
    >
      <div className="flex gap-1 px-2 pt-2">
        {(
          [
            ["wechat", "wechat.inbox.emojiTabWechat"],
            ["kaomoji", "wechat.inbox.emojiTabKaomoji"],
          ] as const
        ).map(([id, labelKey]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] transition-colors",
              tab === id
                ? "bg-[var(--wx-accent)] text-white"
                : "text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === "wechat" ? (
        <div className="flex max-h-[min(240px,38vh)] min-h-0 flex-col overflow-hidden">
          {recentEmojis.length > 0 && (
            <section className="shrink-0 border-b border-[var(--wx-border)]">
              <h3 className="px-2 pb-1 pt-1.5 text-[10px] font-medium text-[var(--wx-muted)]">
                {t("wechat.inbox.emojiSectionRecent")}
              </h3>
              <WechatEmojiGrid
                emojis={recentEmojis}
                onSelect={handleWechatEmoji}
              />
            </section>
          )}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <h3 className="shrink-0 px-2 pb-1 pt-1.5 text-[10px] font-medium text-[var(--wx-muted)]">
              {t("wechat.inbox.emojiSectionAll")}
            </h3>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <WechatEmojiGrid
                emojis={wechatEmojis}
                onSelect={handleWechatEmoji}
              />
            </div>
          </section>
        </div>
      ) : (
        <div className="inbox-kaomoji-grid max-h-[min(240px,38vh)] overflow-y-auto px-2 py-2">
          {INBOX_KAOMOJI.map((item) => (
            <button
              key={item}
              type="button"
              title={item}
              className="rounded px-1.5 py-1 text-sm leading-none text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)]"
              onClick={() => onInsert(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
