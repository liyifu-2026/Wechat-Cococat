import { describe, expect, it } from "vitest"
import { mediaDataUrl } from "@/hooks/use-message-media-cache"
import {
  estimateVoiceDurationSeconds,
  isPlayableVoiceMedia,
  normalizeAudioDataUrl,
  resolveMediaMime,
} from "@/lib/inbox-media-playable"

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

function wavSilenceData(seconds: number): string {
  const sampleRate = 8000
  const bytesPerSample = 2
  const dataSize = sampleRate * bytesPerSample * seconds
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const) {
    for (let i = 0; i < text.length; i += 1) {
      bytes[offset + i] = text.charCodeAt(i)
    }
  }
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, dataSize, true)
  return base64(bytes)
}

function mp3FrameData(frameCount: number): string {
  const frameLength = 417
  const bytes = new Uint8Array(frameLength * frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * frameLength
    bytes[offset] = 0xff
    bytes[offset + 1] = 0xfb
    bytes[offset + 2] = 0x90
    bytes[offset + 3] = 0x00
  }
  return base64(bytes)
}

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

  it("estimates wav voice duration from the file header", () => {
    expect(
      estimateVoiceDurationSeconds({
        type: "voice",
        format: "wav",
        data: wavSilenceData(3),
        filename: "voice.wav",
      }),
    ).toBe(3)
  })

  it("estimates mp3 voice duration from audio frames", () => {
    const duration = estimateVoiceDurationSeconds({
      type: "voice",
      format: "mp3",
      data: mp3FrameData(10),
      filename: "voice.mp3",
    })
    expect(duration).toBeGreaterThan(0.25)
    expect(duration).toBeLessThan(0.27)
  })
})
