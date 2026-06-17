import type { DriverMediaResult } from "@/lib/driver-client"

export function resolveMediaMime(result: DriverMediaResult): string {
  const fmt = (result.format || "").toLowerCase()
  if (result.type === "voice") {
    if (fmt === "mp3" || fmt === "mpeg") return "audio/mpeg"
    if (fmt === "wav") return "audio/wav"
    if (fmt === "silk") return "audio/silk"
    return "audio/mpeg"
  }
  if (result.type === "video") {
    if (fmt === "mp4") return "video/mp4"
    return fmt.includes("/") ? fmt : "video/mp4"
  }
  if (fmt === "png") return "image/png"
  if (fmt === "gif") return "image/gif"
  if (fmt === "webp") return "image/webp"
  return fmt.includes("/") ? fmt : "image/jpeg"
}

export function normalizeAudioDataUrl(url: string): string {
  if (url.startsWith("data:mp3;")) {
    return url.replace("data:mp3;", "data:audio/mpeg;")
  }
  return url
}

export function isPlayableVoiceMedia(
  media: DriverMediaResult | null | undefined,
): boolean {
  if (!media || media.type !== "voice") return false
  if (media.format === "silk") return false
  return Boolean(media.data)
}

export function isPlayableVisualMedia(
  media: DriverMediaResult | null | undefined,
): boolean {
  if (!media) return false
  if (
    media.type === "pending" ||
    media.type === "unsupported" ||
    !media.data
  ) {
    return false
  }
  return (
    media.type === "image" ||
    media.type === "emoji" ||
    media.type === "video"
  )
}
