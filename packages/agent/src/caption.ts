import {
  captionImage,
  captionVideoCover,
  captionVoice,
  loadCaptionLlmConfig,
} from "./caption-llm.js";
import { markCaptionDirty } from "./caption-dirty.js";
import { readCaption, writeCaption } from "./wiki-registry.js";

const PLACEHOLDER = {
  image: "图片内容",
  voice: "语音内容",
  video: "视频内容",
} as const;

function placeholder(kind: keyof typeof PLACEHOLDER): string {
  return PLACEHOLDER[kind];
}

function isPlaceholder(kind: keyof typeof PLACEHOLDER, text: string): boolean {
  return text === PLACEHOLDER[kind];
}

function writeCaptionTracked(
  chatId: string | undefined,
  captionsDir: string,
  localId: number,
  text: string,
  markDirty: boolean,
): void {
  writeCaption(captionsDir, localId, text);
  if (markDirty && chatId) {
    markCaptionDirty(chatId, localId);
  }
}

async function runCaptionJob(
  captionsDir: string,
  localId: number,
  chatId: string | undefined,
  job: () => Promise<string | undefined>,
): Promise<void> {
  const config = loadCaptionLlmConfig();
  if (!config) return;

  try {
    const text = await job();
    if (text?.trim()) {
      writeCaptionTracked(chatId, captionsDir, localId, text.trim(), true);
    }
  } catch (err) {
    console.warn(
      `[pi-wechat] caption ${localId} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    }),
  ]);
}

const DEFAULT_CAPTION_SYNC_TIMEOUT_MS = Number(
  process.env.CAPTION_SYNC_TIMEOUT_MS ?? "8000",
);

/** 同步返回已有/占位 caption；LLM 在后台异步升级。 */
export function ensureCaptionSync(
  captionsDir: string,
  localId: number,
  kind: keyof typeof PLACEHOLDER,
): string {
  const existing = readCaption(captionsDir, localId);
  if (existing) return existing;
  const ph = placeholder(kind);
  writeCaption(captionsDir, localId, ph);
  return ph;
}

export async function resolveVoiceCaptionSync(
  chatId: string,
  captionsDir: string,
  localId: number,
  audioDataUrl: string,
  timeoutMs = DEFAULT_CAPTION_SYNC_TIMEOUT_MS,
): Promise<string> {
  const existing = readCaption(captionsDir, localId);
  if (existing && !isPlaceholder("voice", existing)) {
    return existing;
  }

  const config = loadCaptionLlmConfig();
  if (!config) {
    return existing ?? ensureCaptionSync(captionsDir, localId, "voice");
  }

  try {
    const text = await raceWithTimeout(
      captionVoice(config, audioDataUrl),
      timeoutMs,
      "voice caption",
    );
    if (text?.trim()) {
      writeCaptionTracked(chatId, captionsDir, localId, text.trim(), true);
      return text.trim();
    }
  } catch (err) {
    console.warn(
      `[pi-wechat] sync voice caption ${localId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return existing ?? ensureCaptionSync(captionsDir, localId, "voice");
}

export async function resolveImageCaptionSync(
  chatId: string,
  captionsDir: string,
  localId: number,
  mimeType: string,
  base64Data: string,
  timeoutMs = DEFAULT_CAPTION_SYNC_TIMEOUT_MS,
): Promise<string> {
  const existing = readCaption(captionsDir, localId);
  if (existing && !isPlaceholder("image", existing)) {
    return existing;
  }

  const config = loadCaptionLlmConfig();
  if (!config) {
    return existing ?? ensureCaptionSync(captionsDir, localId, "image");
  }

  try {
    const text = await raceWithTimeout(
      captionImage(config, mimeType, base64Data),
      timeoutMs,
      "image caption",
    );
    if (text?.trim()) {
      writeCaptionTracked(chatId, captionsDir, localId, text.trim(), true);
      return text.trim();
    }
  } catch (err) {
    console.warn(
      `[pi-wechat] sync image caption ${localId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return existing ?? ensureCaptionSync(captionsDir, localId, "image");
}

export function scheduleImageCaption(
  captionsDir: string,
  localId: number,
  mimeType: string,
  base64Data: string,
  chatId?: string,
): void {
  const config = loadCaptionLlmConfig();
  if (!config) return;
  const existing = readCaption(captionsDir, localId);
  if (existing && !isPlaceholder("image", existing)) return;
  void runCaptionJob(captionsDir, localId, chatId, () =>
    captionImage(config, mimeType, base64Data),
  );
}

export function scheduleVoiceCaption(
  captionsDir: string,
  localId: number,
  audioDataUrl: string,
  chatId?: string,
): void {
  const config = loadCaptionLlmConfig();
  if (!config) return;
  const existing = readCaption(captionsDir, localId);
  if (existing && !isPlaceholder("voice", existing)) return;
  void runCaptionJob(captionsDir, localId, chatId, () =>
    captionVoice(config, audioDataUrl),
  );
}

export function scheduleVideoCoverCaption(
  captionsDir: string,
  localId: number,
  mimeType: string,
  base64Data: string,
  chatId?: string,
): void {
  const config = loadCaptionLlmConfig();
  if (!config) return;
  const existing = readCaption(captionsDir, localId);
  if (existing && !isPlaceholder("video", existing)) return;
  void runCaptionJob(captionsDir, localId, chatId, () =>
    captionVideoCover(config, mimeType, base64Data),
  );
}

/** @deprecated 使用 ensureCaptionSync + schedule* */
export async function ensureCaption(
  captionsDir: string,
  localId: number,
  kind: "image" | "voice",
): Promise<string | undefined> {
  const text = ensureCaptionSync(captionsDir, localId, kind);
  return text;
}
