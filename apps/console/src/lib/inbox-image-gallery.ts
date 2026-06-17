import type { DriverMessage } from "@/lib/driver-types"
import {
  fetchDriverMessageMedia,
  type DriverMediaResult,
} from "@/lib/driver-client"
import {
  getCachedMedia,
  mediaDataUrl,
} from "@/hooks/use-message-media-cache"
import type { LightboxItem } from "@/stores/lightbox-store"

const GALLERY_MEDIA_KINDS = new Set(["image", "emoji", "video"])

export function isInboxGalleryMediaKind(kind: string | undefined): boolean {
  return GALLERY_MEDIA_KINDS.has(kind ?? "")
}

function galleryItemFromMessage(
  chatId: string,
  message: DriverMessage,
  media: DriverMediaResult | null,
): LightboxItem | null {
  if (!isInboxGalleryMediaKind(message.mediaKind)) return null

  const src = media ? mediaDataUrl(media) : ""
  return {
    id: `${chatId}:${message.localId}`,
    src: src ?? "",
    alt: message.content?.trim() || undefined,
    filename: media?.filename || `image-${message.localId}.jpg`,
    mediaRef: { chatId, localId: message.localId },
  }
}

/** Build a lightbox gallery from currently visible inbox messages. */
export function buildInboxImageGallery(
  chatId: string,
  messages: DriverMessage[],
): LightboxItem[] {
  const items: LightboxItem[] = []
  for (const message of messages) {
    if (!isInboxGalleryMediaKind(message.mediaKind)) continue
    const media = getCachedMedia(chatId, message.localId)
    const item = galleryItemFromMessage(chatId, message, media)
    if (item) items.push(item)
  }
  return items
}

export async function resolveInboxLightboxSrc(
  mediaRef: { chatId: string; localId: number },
): Promise<string | null> {
  const cached = getCachedMedia(mediaRef.chatId, mediaRef.localId)
  if (cached) return mediaDataUrl(cached)

  const fetched = await fetchDriverMessageMedia(
    mediaRef.chatId,
    mediaRef.localId,
  )
  if (!fetched) return null
  return mediaDataUrl(fetched)
}
