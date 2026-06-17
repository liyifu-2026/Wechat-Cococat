import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"

const VIEWPORT_MARGIN = 16

function clampOffset(
  x: number,
  y: number,
  el: HTMLElement | null,
): { x: number; y: number } {
  if (!el) return { x, y }
  const rect = el.getBoundingClientRect()
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  const centerX = window.innerWidth / 2 + x
  const centerY = window.innerHeight / 2 + y
  const minCenterX = halfW + VIEWPORT_MARGIN
  const maxCenterX = window.innerWidth - halfW - VIEWPORT_MARGIN
  const minCenterY = halfH + VIEWPORT_MARGIN
  const maxCenterY = window.innerHeight - halfH - VIEWPORT_MARGIN
  return {
    x: Math.min(maxCenterX, Math.max(minCenterX, centerX)) - window.innerWidth / 2,
    y: Math.min(maxCenterY, Math.max(minCenterY, centerY)) - window.innerHeight / 2,
  }
}

type DragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onDoubleClick: () => void
}

export function useDraggableDialog(open: boolean) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const resetPosition = useCallback(() => {
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (!open) resetPosition()
  }, [open, resetPosition])

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      dragRef.current = null
    }
  }, [])

  const dragHandleProps: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== 0) return
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    onPointerMove: (event) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      setOffset(
        clampOffset(
          drag.originX + dx,
          drag.originY + dy,
          contentRef.current,
        ),
      )
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onDoubleClick: resetPosition,
  }

  const contentStyle: CSSProperties = {
    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
  }

  return { contentRef, dragHandleProps, contentStyle, resetPosition }
}
