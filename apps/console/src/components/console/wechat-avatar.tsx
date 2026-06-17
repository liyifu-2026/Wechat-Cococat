import { useEffect, useMemo, useState } from "react"
import { fetchDriverAvatarObjectUrl } from "@/lib/driver-client"
import { chatAvatarClass, chatAvatarLetterFromText } from "@/lib/wechat-ui"

type WeChatAvatarProps = {
  /** WeChat CDN URL from contact.db */
  smallHeadUrl?: string | null
  /** Fallback color key (wxid or chat id) */
  colorKey: string
  /** Letter when image unavailable */
  letter: string
  className?: string
  size?: "sm" | "md" | "list"
}

const SIZE_CLASS = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-xs",
  list: "h-10 w-10 text-sm",
} as const

/** Small rounded square — matches WeChat PC avatar shape. */
const AVATAR_SHAPE = "rounded-sm"

export type AvatarSource = "cdn" | "letter" | "failed"

export function WeChatAvatar({
  smallHeadUrl,
  colorKey,
  letter,
  className = "",
  size = "md",
}: WeChatAvatarProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  const hasUrl = Boolean(smallHeadUrl?.trim())

  useEffect(() => {
    let cancelled = false
    setFetchFailed(false)
    setImgFailed(false)
    setImgSrc(null)

    if (!hasUrl) return

    void fetchDriverAvatarObjectUrl(smallHeadUrl!).then((url) => {
      if (cancelled) return
      if (url) {
        setImgSrc(url)
      } else {
        setFetchFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [hasUrl, smallHeadUrl])

  const sizeClass = SIZE_CLASS[size]
  const showImage = Boolean(imgSrc) && !fetchFailed && !imgFailed

  const avatarSource = useMemo((): AvatarSource => {
    if (!hasUrl) return "letter"
    if (showImage) return "cdn"
    return "failed"
  }, [hasUrl, showImage])

  const devAttrs =
    import.meta.env.DEV
      ? ({ "data-avatar-source": avatarSource } as const)
      : {}

  if (showImage) {
    return (
      <img
        src={imgSrc!}
        alt=""
        {...devAttrs}
        className={`${sizeClass} shrink-0 ${AVATAR_SHAPE} object-cover ${className}`}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <span
      {...devAttrs}
      className={`flex ${sizeClass} shrink-0 items-center justify-center ${AVATAR_SHAPE} font-semibold ${chatAvatarClass(colorKey)} ${className}`}
    >
      {chatAvatarLetterFromText(letter)}
    </span>
  )
}
