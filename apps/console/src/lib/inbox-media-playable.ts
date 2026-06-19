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

function base64ToBytes(data: string): Uint8Array | null {
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

const MP3_BITRATES: Record<number, readonly number[]> = {
  10: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  11: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
}

const MP3_SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
}

function estimateMp3DurationSeconds(bytes: Uint8Array): number | null {
  let offset = 0
  if (
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33 &&
    bytes.length >= 10
  ) {
    offset =
      10 +
      ((bytes[6] & 0x7f) << 21) +
      ((bytes[7] & 0x7f) << 14) +
      ((bytes[8] & 0x7f) << 7) +
      (bytes[9] & 0x7f)
  }

  let seconds = 0
  let frames = 0
  while (offset + 4 < bytes.length && frames < 20_000) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }

    const versionBits = (bytes[offset + 1] >> 3) & 0x03
    const layerBits = (bytes[offset + 1] >> 1) & 0x03
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03
    const padding = (bytes[offset + 2] >> 1) & 0x01

    if (
      versionBits === 1 ||
      layerBits !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex === 3
    ) {
      offset += 1
      continue
    }

    const bitrate = MP3_BITRATES[versionBits === 3 ? 11 : 10]?.[bitrateIndex]
    const sampleRate = MP3_SAMPLE_RATES[versionBits]?.[sampleRateIndex]
    if (!bitrate || !sampleRate) {
      offset += 1
      continue
    }

    const samplesPerFrame = versionBits === 3 ? 1152 : 576
    const frameLength =
      versionBits === 3
        ? Math.floor((144000 * bitrate) / sampleRate + padding)
        : Math.floor((72000 * bitrate) / sampleRate + padding)
    if (frameLength <= 4) {
      offset += 1
      continue
    }

    seconds += samplesPerFrame / sampleRate
    frames += 1
    offset += frameLength
  }

  return frames > 0 ? seconds : null
}

function estimateWavDurationSeconds(bytes: Uint8Array): number | null {
  if (
    bytes.length < 44 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let byteRate = 0
  let dataSize = 0
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    )
    const size = view.getUint32(offset + 4, true)
    if (id === "fmt " && offset + 16 <= bytes.length) {
      byteRate = view.getUint32(offset + 16, true)
    } else if (id === "data") {
      dataSize = size
    }
    offset += 8 + size + (size % 2)
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null
}

export function estimateVoiceDurationSeconds(
  media: DriverMediaResult,
): number | null {
  if (media.type !== "voice" || !media.data) return null
  const bytes = base64ToBytes(media.data)
  if (!bytes) return null
  const fmt = media.format.toLowerCase()
  if (fmt === "mp3" || fmt === "mpeg") return estimateMp3DurationSeconds(bytes)
  if (fmt === "wav") return estimateWavDurationSeconds(bytes)
  return null
}
