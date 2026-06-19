import { memo, useEffect, useRef, useState } from "react"
import type { DriverMessage } from "@/lib/driver-types"
import {
  getCachedMedia,
  mediaDataUrl,
  useMessageMedia,
} from "@/hooks/use-message-media-cache"
import {
  isPlayableVoiceMedia,
  isPlayableVisualMedia,
} from "@/lib/inbox-media-playable"
import { VoiceMessageBubble } from "@/components/console/voice-message-bubble"

type InboxMessageMediaProps = {
  chatId: string
  message: DriverMessage
  fallbackLabel: string
  isSelf?: boolean
  onImageClick?: (localId: number) => void
}

/** Fixed bubble frame — prevents scroll jump when images load async. */
export const INBOX_IMAGE_THUMB_PX = 180

const MEDIA_SHELL =
  "overflow-hidden rounded-sm bg-[var(--wx-media-placeholder)] shadow-sm ring-1 ring-black/5 dark:ring-white/5"

function ImagePlaceholder() {
  return (
    <div
      className={`${MEDIA_SHELL} h-[180px] w-[180px] max-w-full animate-pulse`}
      aria-hidden
    />
  )
}

function VoiceLoadingPlaceholder() {
  return (
    <div
      className="flex h-10 min-w-[12rem] max-w-full items-center gap-2 px-0.5"
      aria-busy
      aria-label="Loading voice"
    >
      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--wx-muted)] border-t-transparent" />
      <div className="h-2 max-w-[8rem] flex-1 animate-pulse rounded bg-[var(--wx-media-placeholder)]" />
    </div>
  )
}

function VisualMediaBubble({
  src,
  alt,
  onClick,
}: {
  src: string
  alt: string
  onClick?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const frameClass = `relative block h-[180px] w-[180px] max-w-full ${MEDIA_SHELL}`

  useEffect(() => {
    setLoaded(false)
  }, [src])

  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [src])

  const image = (
    <>
      {!loaded && (
        <div
          className="absolute inset-0 animate-pulse bg-[var(--wx-media-placeholder)]"
          aria-hidden
        />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className="h-full w-full object-cover"
      />
    </>
  )

  if (!onClick) {
    return <div className={frameClass}>{image}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${frameClass} cursor-zoom-in`}
      aria-label={alt}
    >
      {image}
    </button>
  )
}

function InboxMessageMediaInner({
  chatId,
  message,
  fallbackLabel,
  isSelf = false,
  onImageClick,
}: InboxMessageMediaProps) {
  const kind = message.mediaKind ?? ""
  const enabled =
    kind === "image" ||
    kind === "emoji" ||
    kind === "voice" ||
    kind === "video"
  const { media, loading } = useMessageMedia(
    chatId,
    message.localId,
    enabled,
  )
  const resolved = media ?? getCachedMedia(chatId, message.localId)
  const voiceReady = kind === "voice" && isPlayableVoiceMedia(resolved)
  const visualReady =
    (kind === "image" || kind === "emoji" || kind === "video") &&
    isPlayableVisualMedia(resolved)

  if (!enabled) {
    return <span>{fallbackLabel}</span>
  }

  if (!voiceReady && !visualReady && loading) {
    if (kind === "voice") {
      return <VoiceLoadingPlaceholder />
    }
    return <ImagePlaceholder />
  }

  if (
    !resolved ||
    resolved.type === "unsupported" ||
    resolved.type === "pending"
  ) {
    return <span>{fallbackLabel}</span>
  }

  if (resolved.type === "voice") {
    return (
      <VoiceMessageBubble
        chatId={chatId}
        localId={message.localId}
        media={resolved}
        fallbackLabel={fallbackLabel}
        isSelf={isSelf}
      />
    )
  }

  if (
    resolved.type === "image" ||
    resolved.type === "emoji" ||
    resolved.type === "video"
  ) {
    const src = mediaDataUrl(resolved)
    if (!src) return <span>{fallbackLabel}</span>
    return (
      <VisualMediaBubble
        src={src}
        alt={fallbackLabel}
        onClick={
          onImageClick
            ? () => onImageClick(message.localId)
            : undefined
        }
      />
    )
  }

  return <span>{fallbackLabel}</span>
}

export const InboxMessageMedia = memo(InboxMessageMediaInner)
