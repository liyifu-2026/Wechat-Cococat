import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { INBOX_AI_BUBBLE_PORTAL_ID, INBOX_AI_PANEL_ID, INBOX_AI_TRIGGER_WRAP_ID } from "@/lib/inbox-ai-hosts"

const GOO_FILTER_ID = "inbox-ai-liquid-goo"

function buildConnectorPath(
  from: DOMRect,
  to: DOMRect,
): { tube: string; flow: string } {
  const startX = from.right
  const startY = from.top + from.height * 0.55
  const endX = to.left + to.width * 0.5
  const endY = to.bottom - 8
  const midX = (startX + endX) * 0.5
  const midY = Math.min(startY, endY) - 24

  const d = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`
  return { tube: d, flow: d }
}

type InboxAiBubbleConnectorProps = {
  open: boolean
}

export function InboxAiBubbleConnector({ open }: InboxAiBubbleConnectorProps) {
  const [paths, setPaths] = useState<{ tube: string; flow: string } | null>(
    null,
  )
  const rafRef = useRef<number | null>(null)

  const updatePaths = useCallback(() => {
    const trigger = document.getElementById(INBOX_AI_TRIGGER_WRAP_ID)
    const panel = document.getElementById(INBOX_AI_PANEL_ID)
    if (!trigger || !panel) {
      setPaths(null)
      return
    }
    const from = trigger.getBoundingClientRect()
    const to = panel.getBoundingClientRect()
    if (from.width === 0 || to.width === 0) {
      setPaths(null)
      return
    }
    setPaths(buildConnectorPath(from, to))
  }, [])

  useEffect(() => {
    if (!open) {
      setPaths(null)
      return
    }

    updatePaths()

    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updatePaths)
    }

    const ro = new ResizeObserver(schedule)
    const trigger = document.getElementById(INBOX_AI_TRIGGER_WRAP_ID)
    const panel = document.getElementById(INBOX_AI_PANEL_ID)
    if (trigger) ro.observe(trigger)
    if (panel) ro.observe(panel)

    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)

    return () => {
      ro.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [open, updatePaths])

  if (!open || !paths) return null

  const host =
    typeof document !== "undefined"
      ? document.getElementById(INBOX_AI_BUBBLE_PORTAL_ID)
      : null
  if (!host) return null

  return createPortal(
    <svg
      className="inbox-ai-bubble-connector"
      aria-hidden
    >
      <defs>
        <filter id={GOO_FILTER_ID}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
            result="goo"
          />
        </filter>
      </defs>
      <g filter={`url(#${GOO_FILTER_ID})`}>
        <path d={paths.tube} className="inbox-ai-bubble-connector__goo" />
        <path d={paths.flow} className="inbox-ai-bubble-connector__flow" />
      </g>
    </svg>,
    host,
  )
}
