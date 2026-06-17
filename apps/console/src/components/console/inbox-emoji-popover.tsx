import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { InboxEmojiPanel } from "@/components/console/inbox-emoji-panel"
import { WECHAT_DIALOG_PORTAL_ID } from "@/hooks/use-wechat-dialog-portal"
import { cn } from "@/lib/utils"

function getInboxPortalContainer(): HTMLElement {
  return document.getElementById(WECHAT_DIALOG_PORTAL_ID) ?? document.body
}

type InboxEmojiPopoverProps = {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onInsert: (text: string) => void
  onClose: () => void
}

type PopoverLayout = {
  left: number
  top: number
  width: number
  caretLeft: number
}

export function InboxEmojiPopover({
  open,
  anchorRef,
  onInsert,
  onClose,
}: InboxEmojiPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<PopoverLayout | null>(null)

  const updateLayout = useCallback(() => {
    const anchor = anchorRef.current
    const popover = popoverRef.current
    if (!anchor || !popover) return

    const anchorRect = anchor.getBoundingClientRect()
    const popoverWidth = Math.min(360, window.innerWidth - 16)
    const popoverHeight = popover.offsetHeight
    const gap = 8
    const left = Math.min(
      Math.max(8, anchorRect.left - 4),
      window.innerWidth - popoverWidth - 8,
    )
    const top = Math.max(8, anchorRect.top - popoverHeight - gap)
    const caretLeft = Math.min(
      popoverWidth - 16,
      Math.max(16, anchorRect.left + anchorRect.width / 2 - left),
    )

    setLayout({ left, top, width: popoverWidth, caretLeft })
  }, [anchorRef])

  useLayoutEffect(() => {
    if (!open) {
      setLayout(null)
      return
    }
    updateLayout()
  }, [open, updateLayout])

  useEffect(() => {
    if (!open) return
    const handleResize = () => updateLayout()
    window.addEventListener("resize", handleResize)
    window.addEventListener("scroll", handleResize, true)
    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("scroll", handleResize, true)
    }
  }, [open, updateLayout])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [anchorRef, onClose, open])

  const handleInsert = useCallback(
    (text: string) => {
      onInsert(text)
      onClose()
    },
    [onClose, onInsert],
  )

  if (!open) return null

  return createPortal(
    <div
      ref={popoverRef}
      className={cn(
        "inbox-emoji-popover inbox-frosted-surface fixed z-[120] rounded-lg border border-[var(--wx-border)] shadow-lg",
        !layout && "invisible",
      )}
      style={
        layout
          ? {
              left: layout.left,
              top: layout.top,
              width: layout.width,
              ["--inbox-emoji-caret-left" as string]: `${layout.caretLeft}px`,
            }
          : { left: -9999, top: -9999, width: 360 }
      }
      role="dialog"
      aria-label="Emoji picker"
    >
      <InboxEmojiPanel open={open} onInsert={handleInsert} className="rounded-lg" />
    </div>,
    getInboxPortalContainer(),
  )
}