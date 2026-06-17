import { useCallback, useState } from "react"
import { transcribeInboxVoice } from "@/lib/caption-inbox-voice-client"

export type VoiceTranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error"; message: string }

const cache = new Map<string, VoiceTranscriptState>()

function cacheKey(chatId: string, localId: number) {
  return `${chatId}:${localId}`
}

export function useVoiceTranscript(chatId: string, localId: number) {
  const key = cacheKey(chatId, localId)
  const [state, setState] = useState<VoiceTranscriptState>(
    () => cache.get(key) ?? { status: "idle" },
  )

  const transcribe = useCallback(
    async (audioDataUrl: string) => {
      const hit = cache.get(key)
      if (hit?.status === "done") {
        setState(hit)
        return
      }
      if (hit?.status === "loading") return

      const loading: VoiceTranscriptState = { status: "loading" }
      cache.set(key, loading)
      setState(loading)

      try {
        const text = await transcribeInboxVoice(audioDataUrl)
        const done: VoiceTranscriptState = { status: "done", text }
        cache.set(key, done)
        setState(done)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err)
        let friendly = message
        if (message === "CAPTION_NOT_CONFIGURED") {
          friendly = "CAPTION_NOT_CONFIGURED"
        } else if (message === "CAPTION_EMPTY") {
          friendly = "CAPTION_EMPTY"
        }
        const error: VoiceTranscriptState = {
          status: "error",
          message: friendly,
        }
        cache.set(key, error)
        setState(error)
      }
    },
    [key],
  )

  return { state, transcribe }
}

export function clearVoiceTranscriptCache() {
  cache.clear()
}

export function pruneVoiceTranscriptCacheForChat(chatId: string): void {
  const prefix = `${chatId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
