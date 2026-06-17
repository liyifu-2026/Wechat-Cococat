import { useEffect, useRef, useState } from "react"
import {
  fetchDriverMessageMedia,
  type DriverMediaResult,
} from "@/lib/driver-client"
import {
  isPlayableVoiceMedia,
  resolveMediaMime,
} from "@/lib/inbox-media-playable"

const cache = new Map<string, DriverMediaResult>()
const inflight = new Map<string, Promise<DriverMediaResult | null>>()

const PENDING_RETRY_MS = 1_500
const PENDING_MAX_RETRIES = 10

function mediaKey(chatId: string, localId: number) {
  return `${chatId}:${localId}`
}

function isCacheableMedia(result: DriverMediaResult | null): boolean {
  if (!result) return false
  if (result.type === "unsupported" || result.type === "pending") return false
  if (result.type === "voice" && result.format === "silk") return false
  return Boolean(result.data)
}

async function loadMedia(
  chatId: string,
  localId: number,
): Promise<DriverMediaResult | null> {
  const key = mediaKey(chatId, localId)
  const hit = cache.get(key)
  if (hit) return hit

  const pending = inflight.get(key)
  if (pending) return pending

  const promise = fetchDriverMessageMedia(chatId, localId)
    .then((result) => {
      if (isCacheableMedia(result)) {
        cache.set(key, result!)
      }
      return result
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  return promise
}

export function useMessageMedia(chatId: string, localId: number, enabled: boolean) {
  const key = mediaKey(chatId, localId)
  const [media, setMedia] = useState<DriverMediaResult | null>(() => {
    return cache.get(key) ?? null
  })
  const [loading, setLoading] = useState(() => {
    if (!enabled) return false
    return !cache.has(key)
  })
  const requestRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    const requestId = ++requestRef.current
    const cached = cache.get(key)
    if (cached) {
      setMedia(cached)
      setLoading(false)
      return
    }

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: DriverMediaResult | null) => {
      if (requestRef.current !== requestId) return
      setMedia(result)
      const ready =
        result != null &&
        (isPlayableVoiceMedia(result) ||
          result.type === "image" ||
          result.type === "emoji" ||
          result.type === "video")
      if (ready || result == null) {
        setLoading(false)
        return
      }
      if (result.type === "pending" && retries < PENDING_MAX_RETRIES) {
        retries += 1
        retryTimer = setTimeout(() => void poll(), PENDING_RETRY_MS)
        return
      }
      setLoading(false)
    }

    const poll = () => {
      if (requestRef.current !== requestId) return
      setLoading(true)
      void loadMedia(chatId, localId).then(finish)
    }

    poll()

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [chatId, localId, enabled, key])

  return { media, loading }
}

export function getCachedMedia(
  chatId: string,
  localId: number,
): DriverMediaResult | null {
  return cache.get(mediaKey(chatId, localId)) ?? null
}

/** Drop cached media payloads for a chat (e.g. history dialog closed). */
export function pruneMediaCacheForChat(chatId: string): void {
  const prefix = `${chatId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

export function mediaDataUrl(result: DriverMediaResult): string | null {
  if (!result.data) return null
  const mime = resolveMediaMime(result)
  return `data:${mime};base64,${result.data}`
}
