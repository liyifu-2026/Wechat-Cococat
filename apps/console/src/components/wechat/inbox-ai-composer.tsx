import { useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { isImeComposing } from "@/lib/keyboard-utils"
import type { AiAssistMode } from "@/stores/ai-assist-store"
import { InboxAiModeSwitch } from "@/components/wechat/inbox-ai-mode-switch"

type InboxAiComposerProps = {
  mode: AiAssistMode
  assistDraft: string
  searchQuery: string
  isStreaming?: boolean
  onModeChange: (mode: AiAssistMode) => void
  onAssistDraftChange: (value: string) => void
  onSearchQueryChange: (value: string) => void
  onAssistSubmit: (text: string) => void
  onSearchSubmit: (query: string) => void
  onAssistStop?: () => void
  wikiReady?: boolean
}

export function InboxAiComposer({
  mode,
  assistDraft,
  searchQuery,
  isStreaming = false,
  onModeChange,
  onAssistDraftChange,
  onSearchQueryChange,
  onAssistSubmit,
  onSearchSubmit,
  onAssistStop,
  wikiReady = true,
}: InboxAiComposerProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const prevModeRef = useRef(mode)

  const value = mode === "assist" ? assistDraft : searchQuery
  const placeholder = !wikiReady
    ? t("wechat.aiAssist.wikiBlockedPlaceholder")
    : mode === "assist"
      ? t("wechat.aiAssist.inputPlaceholder")
      : t("wechat.aiAssist.searchPlaceholder")

  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [mode])

  function handleChange(next: string) {
    if (mode === "assist") onAssistDraftChange(next)
    else onSearchQueryChange(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (isImeComposing(e)) return
    if (e.key !== "Enter") return
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || !wikiReady) return
    if (mode === "assist") {
      if (isStreaming) {
        onAssistStop?.()
        return
      }
      onAssistSubmit(trimmed)
      onAssistDraftChange("")
    } else {
      onSearchSubmit(trimmed)
    }
  }

  return (
    <footer className="shrink-0 border-t border-[var(--wx-border)]/40 px-3 py-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={!wikiReady}
        className="inbox-ai-composer-input mb-1.5"
        aria-label={placeholder}
      />
      <InboxAiModeSwitch mode={mode} onModeChange={onModeChange} />
    </footer>
  )
}
