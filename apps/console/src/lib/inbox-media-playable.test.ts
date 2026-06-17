import { describe, expect, it } from "vitest"
import { mediaDataUrl } from "@/hooks/use-message-media-cache"
import {
  isPlayableVoiceMedia,
  normalizeAudioDataUrl,
  resolveMediaMime,
} from "@/lib/inbox-media-playable"

describe("inbox media playable", () => {
  const mp3Voice = {
    type: "voice",
    format: "mp3",
    data: "abc",
    filename: "voice.mp3",
  }

  it("maps mp3 voice format to audio/mpeg data URL", () => {
    const mime = resolveMediaMime(mp3Voice)
    expect(mime).toBe("audio/mpeg")
    expect(mediaDataUrl(mp3Voice)).toBe("data:audio/mpeg;base64,abc")
  })

  it("normalizes legacy data:mp3 URLs", () => {
    expect(normalizeAudioDataUrl("data:mp3;base64,xyz")).toBe(
      "data:audio/mpeg;base64,xyz",
    )
  })

  it("treats silk voice as not playable", () => {
    expect(
      isPlayableVoiceMedia({
        type: "voice",
        format: "silk",
        data: "abc",
        filename: "voice.silk",
      }),
    ).toBe(false)
    expect(isPlayableVoiceMedia(mp3Voice)).toBe(true)
  })
})
