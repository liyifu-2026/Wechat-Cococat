import { useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export type WheelPickerOption = {
  value: string
  label: string
}

const ITEM_HEIGHT = 44

type WheelPickerProps = {
  options: WheelPickerOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

export function WheelPicker({
  options,
  value,
  onChange,
  className,
  disabled = false,
}: WheelPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const scrollEndTimer = useRef<number | null>(null)
  const dragRef = useRef<{ active: boolean; startY: number; startScroll: number }>({
    active: false,
    startY: 0,
    startScroll: 0,
  })
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  const scrollToIndex = useCallback(
    (i: number, smooth = false) => {
      const el = listRef.current
      if (!el) return
      const clamped = Math.max(0, Math.min(i, options.length - 1))
      el.scrollTo({
        top: clamped * ITEM_HEIGHT,
        behavior: smooth ? "smooth" : "auto",
      })
    },
    [options.length],
  )

  useEffect(() => {
    scrollToIndex(index)
  }, [index, scrollToIndex])

  const commitScrollPosition = useCallback(() => {
    const el = listRef.current
    if (!el || options.length === 0 || disabled) return
    const i = Math.round(el.scrollTop / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(i, options.length - 1))
    scrollToIndex(clamped, true)
    const next = options[clamped]?.value ?? ""
    if (next !== value) onChange(next)
  }, [disabled, onChange, options, scrollToIndex, value])

  const handleScroll = () => {
    if (scrollEndTimer.current != null) {
      window.clearTimeout(scrollEndTimer.current)
    }
    scrollEndTimer.current = window.setTimeout(commitScrollPosition, 80)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    const el = listRef.current
    if (!el) return
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startScroll: el.scrollTop,
    }
    el.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active || disabled) return
    const el = listRef.current
    if (!el) return
    const delta = dragRef.current.startY - e.clientY
    el.scrollTop = dragRef.current.startScroll + delta
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    listRef.current?.releasePointerCapture(e.pointerId)
    commitScrollPosition()
  }

  return (
    <div
      className={cn(
        "relative h-[132px] overflow-hidden rounded-xl border border-[var(--wx-border)] bg-[var(--wx-list-hover)]",
        disabled && "opacity-50",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-[44px] -translate-y-1/2 rounded-lg border border-[var(--wx-accent)]/40 bg-[var(--wx-accent)]/10"
        aria-hidden
      />
      <ul
        ref={listRef}
        className="wheel-picker-list h-full touch-pan-y overflow-y-auto scroll-smooth py-[44px]"
        style={{ scrollSnapType: "y mandatory" }}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {options.map((opt) => (
          <li
            key={opt.value || "__unset__"}
            className="flex h-[44px] shrink-0 cursor-grab items-center justify-center scroll-snap-align-center px-4 text-sm text-[var(--wx-text)] active:cursor-grabbing"
            style={{ scrollSnapAlign: "center" }}
          >
            {opt.label}
          </li>
        ))}
      </ul>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[var(--wx-list-hover)] to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--wx-list-hover)] to-transparent"
        aria-hidden
      />
    </div>
  )
}
