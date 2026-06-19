import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { createPortal } from "react-dom"
import { Volume2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { DriverMediaResult } from "@/lib/driver-client"
import { useVoiceTranscript } from "@/hooks/use-voice-transcript"
import { mediaDataUrl } from "@/hooks/use-message-media-cache"
import { estimateVoiceDurationSeconds } from "@/lib/inbox-media-playable"
import { useContextMenuDismiss } from "@/hooks/use-context-menu-dismiss"
import { WECHAT_DIALOG_PORTAL_ID } from "@/hooks/use-wechat-dialog-portal"

function voiceNotReady(media: DriverMediaResult): boolean {
  return (
    media.format === "silk" ||
    media.type === "pending" ||
    media.type === "unsupported"
  )
}

function voiceTranscriptErrorLabel(
  message: string,
  t: (key: string) => string,
): string {
  if (message === "CAPTION_NOT_CONFIGURED") {
    return t("wechat.inbox.voiceTranscribeNoConfig")
  }
  if (message === "CAPTION_EMPTY") {
    return t("wechat.inbox.voiceTranscribeEmpty")
  }
  if (message === "CAPTION_TIMEOUT") {
    return t("wechat.inbox.voiceTranscribeFailed")
  }
  if (message.startsWith("caption LLM HTTP 401") || message.includes("401")) {
    return t("wechat.inbox.voiceTranscribeNoConfig")
  }
  if (message.startsWith("caption LLM HTTP")) {
    return t("wechat.inbox.voiceTranscribeFailed")
  }
  if (message.length > 0 && message.length <= 160) return message
  return t("wechat.inbox.voiceTranscribeFailed")
}

function formatVoiceDuration(duration: number | null): string {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    return "--''"
  }
  return `${Math.max(1, Math.round(duration))}''`
}

function voiceWidth(duration: number | null): number {
  const seconds =
    duration == null || !Number.isFinite(duration) ? 8 : Math.max(1, duration)
  return Math.round(Math.min(220, Math.max(96, 86 + seconds * 4)))
}

function getPortalContainer(): HTMLElement {
  return document.getElementById(WECHAT_DIALOG_PORTAL_ID) ?? document.body
}

function VoiceContextMenu({
  x,
  y,
  disabled,
  onClose,
  onTranscribe,
}: {
  x: number
  y: number
  disabled: boolean
  onClose: () => void
  onTranscribe: () => void
}) {
  const { t } = useTranslation()
  useContextMenuDismiss(true, onClose)

  return createPortal(
    <div
      className="inbox-frosted-surface fixed z-[220] min-w-[9rem] rounded-lg border border-[var(--wx-border)] py-1 text-xs text-[var(--wx-text)] shadow-xl ring-1 ring-black/10 dark:ring-white/10"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        disabled={disabled}
        className="block w-full px-3 py-2 text-left text-[var(--wx-accent)] hover:bg-[var(--wx-list-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          onTranscribe()
          onClose()
        }}
      >
        {t("wechat.inbox.voiceTranscribe")}
      </button>
    </div>,
    getPortalContainer(),
  )
}

export function VoiceMessageBubble({
  chatId,
  localId,
  media,
  fallbackLabel,
  isSelf = false,
}: {
  chatId: string
  localId: number
  media: DriverMediaResult
  fallbackLabel: string
  isSelf?: boolean
}) {
  const { t } = useTranslation()
  const src = mediaDataUrl(media)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const estimatedDuration = useMemo(
    () => estimateVoiceDurationSeconds(media),
    [media],
  )
  const [duration, setDuration] = useState<number | null>(estimatedDuration)
  const [playing, setPlaying] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const { state, transcribe } = useVoiceTranscript(chatId, localId)

  useEffect(() => {
    setDuration(estimatedDuration)
  }, [estimatedDuration])

  useEffect(() => {
    if (!src) return
    const audio = new Audio(src)
    audio.preload = "metadata"
    audioRef.current = audio

    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration)
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)

    audio.addEventListener("loadedmetadata", syncDuration)
    audio.addEventListener("durationchange", syncDuration)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)
    audio.load()

    return () => {
      audio.pause()
      audio.removeEventListener("loadedmetadata", syncDuration)
      audio.removeEventListener("durationchange", syncDuration)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
      audioRef.current = null
      setPlaying(false)
    }
  }, [src])

  const handleTranscribe = useCallback(() => {
    if (!src) return
    if (voiceNotReady(media)) return
    void transcribe(src)
  }, [media, src, transcribe])

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      await audio.play().catch(() => undefined)
      return
    }
    audio.pause()
  }, [])

  const openMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({ x: event.clientX, y: event.clientY })
    },
    [],
  )

  const showTranscript =
    state.status === "done" ||
    state.status === "loading" ||
    state.status === "error"

  if (!src) return <span>{fallbackLabel}</span>

  return (
    <div className={`flex max-w-full flex-col gap-1.5 ${isSelf ? "items-end" : "items-start"}`}>
      <button
        type="button"
        className={`group relative flex h-9 max-w-full items-center gap-2 rounded px-3 text-left text-sm shadow-sm transition hover:brightness-105 ${
          isSelf
            ? "flex-row-reverse bg-[var(--wx-bubble-self)] text-[var(--wx-bubble-self-text)]"
            : "border border-[var(--wx-bubble-other-border)] bg-[var(--wx-bubble-other)] text-[var(--wx-bubble-other-text)]"
        }`}
        style={{ width: voiceWidth(duration) }}
        aria-label={t("wechat.inbox.mediaVoice")}
        onClick={(e) => {
          e.stopPropagation()
          void togglePlay()
        }}
        onContextMenu={openMenu}
      >
        <span
          className={`flex shrink-0 items-center ${
            playing ? "animate-pulse" : ""
          } ${isSelf ? "rotate-180" : ""}`}
          aria-hidden
        >
          <Volume2 className="h-4 w-4" />
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            isSelf ? "text-[var(--wx-bubble-self-meta)]" : "text-[var(--wx-bubble-other-meta)]"
          }`}
        >
          {formatVoiceDuration(duration)}
        </span>
      </button>

      {showTranscript && (
        <p className="max-w-[18rem] whitespace-pre-wrap break-words rounded bg-[var(--wx-search-input)] px-2 py-1 text-xs leading-relaxed text-[var(--wx-text)]">
          {state.status === "loading" && t("wechat.inbox.voiceTranscribing")}
          {state.status === "done" && state.text}
          {state.status === "error" &&
            voiceTranscriptErrorLabel(state.message, t)}
        </p>
      )}

      {menu && (
        <VoiceContextMenu
          x={menu.x}
          y={menu.y}
          disabled={state.status === "loading" || voiceNotReady(media)}
          onClose={() => setMenu(null)}
          onTranscribe={handleTranscribe}
        />
      )}
    </div>
  )
}
