import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minimize2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { isLargeComposeText } from "@/lib/compose-large-text"

type InboxComposeExpandOverlayProps = {
  open: boolean
  value: string
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onClose: () => void
  disabled?: boolean
}

export type InboxComposeExpandOverlayHandle = {
  getValue: () => string
}

export const INBOX_COMPOSE_EXPAND_HOST_ID = "inbox-compose-expand-host"

export const InboxComposeExpandOverlay = forwardRef<
  InboxComposeExpandOverlayHandle,
  InboxComposeExpandOverlayProps
>(function InboxComposeExpandOverlay(
  { open, value, onChange, onCommit, onClose, disabled = false },
  ref,
) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uncontrolled, setUncontrolled] = useState(() => isLargeComposeText(value))

  useImperativeHandle(ref, () => ({
    getValue: () => textareaRef.current?.value ?? value,
  }))

  useLayoutEffect(() => {
    if (!open) return
    setUncontrolled(isLargeComposeText(value))
    const ta = textareaRef.current
    if (ta) {
      ta.value = value
      ta.focus()
    }
    // Seed textarea only when the overlay opens; value is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open])

  const commitAndClose = () => {
    const next = textareaRef.current?.value ?? value
    onCommit(next)
    onClose()
  }

  const handleControlledChange = (next: string) => {
    if (isLargeComposeText(next)) {
      const ta = textareaRef.current
      if (ta) ta.value = next
      setUncontrolled(true)
      return
    }
    onChange(next)
  }

  if (!open) return null

  const host =
    typeof document !== "undefined"
      ? document.getElementById(INBOX_COMPOSE_EXPAND_HOST_ID)
      : null

  const panel = (
    <div className="pointer-events-auto flex h-full flex-col border border-[var(--wx-border)] bg-[var(--wx-header-bg)] shadow-lg">
      <div className="flex shrink-0 items-center justify-end border-b border-[var(--wx-border)] px-3 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label={t("wechat.inbox.composeCollapse")}
          onClick={commitAndClose}
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </div>
      <textarea
        key={uncontrolled ? "uncontrolled" : "controlled"}
        ref={textareaRef}
        dir="auto"
        disabled={disabled}
        {...(uncontrolled
          ? { defaultValue: value }
          : { value, onChange: (e) => handleControlledChange(e.target.value) })}
        placeholder={t("wechat.inbox.composePlaceholder")}
        className="min-h-[8rem] flex-1 resize-y border-0 bg-[var(--wx-search-input)] px-4 py-3 text-sm leading-relaxed text-[var(--wx-text)] placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  )

  if (host) {
    return createPortal(
      <div className="absolute inset-2 z-10">{panel}</div>,
      host,
    )
  }

  return panel
})

export function ComposeExpandButton({
  visible,
  onClick,
  inline = false,
}: {
  visible: boolean
  onClick: () => void
  inline?: boolean
}) {
  const { t } = useTranslation()
  if (!visible) return null

  return (
    <button
      type="button"
      className={
        inline
          ? "rounded p-0.5 text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
          : "absolute right-2 top-2 rounded p-0.5 text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
      }
      aria-label={t("wechat.inbox.composeExpand")}
      onClick={onClick}
    >
      <Maximize2 className="h-3.5 w-3.5" />
    </button>
  )
}
