import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useWechatDialogPortal } from "@/hooks/use-wechat-dialog-portal"
import { cn } from "@/lib/utils"

export type ContactTypeOption = {
  value: string
  label: string
}

type ContactTypePickerSheetProps = {
  open: boolean
  options: ContactTypeOption[]
  value: string
  disabled?: boolean
  onClose: () => void
  onSelect: (value: string) => void
}

/** 底部上拉 · 列表点选（非滚轮），暗色主题变量。 */
export function ContactTypePickerSheet({
  open,
  options,
  value,
  disabled = false,
  onClose,
  onSelect,
}: ContactTypePickerSheetProps) {
  const { t } = useTranslation()
  const portal = useWechatDialogPortal(open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open || !portal) return null

  function handleSelect(next: string) {
    if (disabled || next === value) {
      onClose()
      return
    }
    onSelect(next)
    onClose()
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[110] bg-black/55"
        onClick={onClose}
        role="presentation"
        aria-hidden
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[110] flex max-h-[min(52vh,360px)] flex-col rounded-t-2xl border-t border-[var(--wx-border)] bg-[var(--wx-header-bg)] text-[var(--wx-text)] shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-type-picker-title"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--wx-border)]" />
        <header className="shrink-0 border-b border-[var(--wx-border)]/60 px-4 py-3 text-center">
          <h3
            id="contact-type-picker-title"
            className="text-sm font-medium text-[var(--wx-text)]"
          >
            {t("wechat.contacts.userTypePickerTitle")}
          </h3>
        </header>
        <ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <li key={opt.value || "__unset__"}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors",
                    active
                      ? "bg-[var(--wechat-brand-muted)] text-[var(--wechat-brand)]"
                      : "text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)]",
                    disabled && "opacity-50",
                  )}
                >
                  <span className="min-w-0 truncate">{opt.label}</span>
                  {active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="shrink-0 border-t border-[var(--wx-border)]/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
            onClick={onClose}
          >
            {t("wechat.contacts.userTypePickerCancel")}
          </Button>
        </div>
      </div>
    </>,
    portal,
  )
}
