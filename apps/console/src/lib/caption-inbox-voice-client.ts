import { invoke } from "@tauri-apps/api/core"
import { captionInboxVoiceFromStack } from "@/lib/inbox-voice-caption"
import { normalizeAudioDataUrl } from "@/lib/inbox-media-playable"
import { isTauri } from "@/lib/tauri-window"

export type CaptionInboxVoiceResult = {
  text?: string | null
  error?: string
}

const VOICE_CAPTION_TIMEOUT_MS = 30_000

function withCaptionTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("CAPTION_TIMEOUT"))
    }, VOICE_CAPTION_TIMEOUT_MS)
  })

  return Promise.race([work(), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

async function captionViaTauri(audioDataUrl: string): Promise<string> {
  const result = await withCaptionTimeout(() =>
    invoke<CaptionInboxVoiceResult>("caption_inbox_voice", {
      audioDataUrl,
    }),
  )
  const text = result.text?.trim()
  if (text) return text
  throw new Error(result.error ?? "CAPTION_EMPTY")
}

/**
 * Transcribe WeChat voice (MP3 data URL). Tries llm-stack caption role first,
 * falls back to Tauri + caption.env when stack config is unavailable.
 */
export async function transcribeInboxVoice(
  audioDataUrl: string,
): Promise<string> {
  const normalized = normalizeAudioDataUrl(audioDataUrl.trim())
  if (!normalized) {
    throw new Error("CAPTION_EMPTY")
  }

  let stackError: unknown
  try {
    return await captionInboxVoiceFromStack(normalized)
  } catch (err) {
    stackError = err
    if (!isTauri()) throw err
  }

  try {
    return await captionViaTauri(normalized)
  } catch (tauriErr) {
    if (stackError) throw stackError
    throw tauriErr
  }
}
