import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { resolveInboxLightboxSrc } from "@/lib/inbox-image-gallery"
import { saveLightboxImage } from "@/lib/lightbox-save-image"
import { revokeObjectUrlIfBlob } from "@/lib/blob-url"
import { useLightboxStore } from "@/stores/lightbox-store"

const MIN_SCALE = 1
const MAX_SCALE = 5
const WHEEL_ZOOM_STEP = 0.12

export function InboxImageLightbox() {
  const { t } = useTranslation()
  const active = useLightboxStore((s) => s.active)
  const items = useLightboxStore((s) => s.items)
  const index = useLightboxStore((s) => s.index)
  const close = useLightboxStore((s) => s.close)
  const next = useLightboxStore((s) => s.next)
  const prev = useLightboxStore((s) => s.prev)

  const item = active ? items[index] : undefined
  const [displaySrc, setDisplaySrc] = useState("")
  const [loading, setLoading] = useState(false)
  const [scale, setScale] = useState(MIN_SCALE)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const panDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const resetView = useCallback(() => {
    setScale(MIN_SCALE)
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (!active || !item) {
      setDisplaySrc("")
      setLoading(false)
      resetView()
      return
    }

    resetView()

    let cancelled = false
    const current = item

    async function resolveSrc() {
      if (current.src) {
        setDisplaySrc(current.src)
        setLoading(false)
        return
      }
      if (!current.mediaRef) {
        setDisplaySrc("")
        setLoading(false)
        return
      }
      setLoading(true)
      const resolved = await resolveInboxLightboxSrc(current.mediaRef)
      if (cancelled) return
      setDisplaySrc(resolved ?? "")
      setLoading(false)
    }

    void resolveSrc()
    return () => {
      cancelled = true
    }
  }, [active, item, resetView])

  useEffect(() => {
    return () => {
      revokeObjectUrlIfBlob(displaySrc)
    }
  }, [displaySrc])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || !active || !displaySrc) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const direction = event.deltaY > 0 ? -1 : 1
      setScale((prevScale) => {
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, prevScale + direction * WHEEL_ZOOM_STEP),
        )
        if (nextScale <= MIN_SCALE) {
          setPan({ x: 0, y: 0 })
        }
        return nextScale
      })
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [active, displaySrc])

  const handleClose = useCallback(() => {
    close()
  }, [close])

  useEffect(() => {
    if (!active) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose()
      if (event.key === "ArrowLeft") prev()
      if (event.key === "ArrowRight") next()
    }

    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [active, handleClose, next, prev])

  const handleSave = useCallback(async () => {
    if (!displaySrc || !item) return
    try {
      await saveLightboxImage(displaySrc, item.filename ?? "image.jpg")
    } catch (err) {
      console.error("[lightbox] save failed:", err)
    }
  }, [displaySrc, item])

  const handleJump = useCallback(() => {
    if (!item?.onJumpToSource) return
    void Promise.resolve(item.onJumpToSource()).finally(() => {
      handleClose()
    })
  }, [handleClose, item])

  const finishPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current
    if (drag?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      panDragRef.current = null
    }
  }, [])

  const handlePanPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scale <= MIN_SCALE || event.button !== 0) return
      panDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [pan.x, pan.y, scale],
  )

  const handlePanPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = panDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      setPan({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      })
    },
    [],
  )

  if (!active || !item) return null

  const showNav = items.length > 1
  const counterLabel = t("lightbox.counter", {
    current: index + 1,
    total: items.length,
  })
  const canPan = scale > MIN_SCALE

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("lightbox.title")}
    >
      {showNav && (
        <>
          <button
            type="button"
            aria-label={t("lightbox.previous")}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white transition-colors hover:bg-black/65"
            onClick={(event) => {
              event.stopPropagation()
              prev()
            }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            aria-label={t("lightbox.next")}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white transition-colors hover:bg-black/65"
            onClick={(event) => {
              event.stopPropagation()
              next()
            }}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div
        className="flex max-h-[92vh] w-[min(92vw,56rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[var(--wechat-dark-panel)] text-[var(--wx-text)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--wx-border)] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {item.alt ? (
              <div className="line-clamp-3 text-sm leading-snug">{item.alt}</div>
            ) : (
              <div className="text-sm italic text-[var(--wx-muted)]">
                {t("lightbox.noCaption")}
              </div>
            )}
            {item.subtitle && (
              <div className="mt-1 truncate text-[11px] text-[var(--wx-muted)]">
                {t("lightbox.from", { title: item.subtitle })}
              </div>
            )}
            {showNav && (
              <div className="mt-1 text-[11px] text-[var(--wx-muted)]">
                {counterLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("lightbox.close")}
            className="shrink-0 rounded-md p-1.5 text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={viewportRef}
          className="relative flex min-h-[min(60vh,32rem)] flex-1 items-center justify-center overflow-hidden bg-black/20 p-4"
          onDoubleClick={resetView}
        >
          {loading ? (
            <div className="h-48 w-48 animate-pulse rounded-md bg-[var(--wx-media-placeholder)]" />
          ) : displaySrc ? (
            <div
              className={`touch-none select-none ${canPan ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: "center center",
              }}
              onPointerDown={handlePanPointerDown}
              onPointerMove={handlePanPointerMove}
              onPointerUp={finishPan}
              onPointerCancel={finishPan}
            >
              <img
                src={displaySrc}
                alt={item.alt || ""}
                draggable={false}
                className="max-h-[min(72vh,40rem)] max-w-full rounded-md object-contain"
              />
            </div>
          ) : (
            <div className="text-sm text-[var(--wx-muted)]">
              {t("lightbox.loadFailed")}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--wx-border)] px-4 py-2.5">
          {item.onJumpToSource && (
            <button
              type="button"
              onClick={handleJump}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--wx-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {t("lightbox.jumpToSource")}
            </button>
          )}
          <button
            type="button"
            disabled={!displaySrc || loading}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--wx-border)] px-3 py-1.5 text-xs font-medium text-[var(--wx-text)] hover:bg-[var(--wx-list-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t("lightbox.saveAs")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
