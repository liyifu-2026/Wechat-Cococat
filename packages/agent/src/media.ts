import { existsSync, readFileSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  resolveArtifactPath,
  type Message,
  type MediaResult,
  type WeChatClient,
} from "@cococat/shared";
import {
  ensureCaptionSync,
  resolveImageCaptionSync,
  resolveVoiceCaptionSync,
  scheduleImageCaption,
  scheduleVideoCoverCaption,
  scheduleVoiceCaption,
} from "./caption.js";
import { readCaption } from "./wiki-registry.js";
import type { MimoAudioInput } from "./mimo-audio.js";

const WECHAT_TYPE_IMAGE = 3;
const WECHAT_TYPE_VOICE = 34;
const WECHAT_TYPE_VIDEO = 43;
const WECHAT_TYPE_EMOJI = 47;
const WECHAT_TYPE_APPMSG = 49;

export type MultimodalBatch = {
  text: string;
  images: ImageContent[];
  audios: MimoAudioInput[];
  userLines: string[];
  hasVoiceWithCaption: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeFromImagePath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function mimeFromVoicePath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".silk")) return undefined;
  return "audio/mpeg";
}

function readArtifactAsImage(artifactRef: string): ImageContent | undefined {
  const path = resolveArtifactPath(artifactRef);
  if (!existsSync(path)) return undefined;
  const data = readFileSync(path).toString("base64");
  return { type: "image", data, mimeType: mimeFromImagePath(path) };
}

function readArtifactAsAudio(artifactRef: string): MimoAudioInput | undefined {
  const path = resolveArtifactPath(artifactRef);
  if (!existsSync(path)) return undefined;
  const mime = mimeFromVoicePath(path);
  if (!mime) return undefined;
  const data = readFileSync(path).toString("base64");
  return { dataUrl: `data:${mime};base64,${data}` };
}

async function fetchMediaWithRetry(
  client: WeChatClient,
  chatId: string,
  localId: number,
  retries = 5,
): Promise<MediaResult> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await client.getMedia(chatId, localId);
    if (result.type !== "pending") return result;
    await sleep(800 * (attempt + 1));
  }
  return client.getMedia(chatId, localId);
}

function mediaToImage(media: MediaResult): ImageContent | undefined {
  if (
    (media.type !== "image" && media.type !== "emoji") ||
    !media.data
  ) {
    return undefined;
  }
  if (media.artifactRef) {
    const fromDisk = readArtifactAsImage(media.artifactRef);
    if (fromDisk) return fromDisk;
  }
  const mimeType =
    media.format === "png"
      ? "image/png"
      : media.format === "gif"
        ? "image/gif"
        : "image/jpeg";
  return { type: "image", data: media.data, mimeType };
}

function mediaToAudio(media: MediaResult): MimoAudioInput | undefined {
  if (media.type !== "voice" || !media.data) return undefined;
  if (media.artifactRef) {
    const fromDisk = readArtifactAsAudio(media.artifactRef);
    if (fromDisk) return fromDisk;
  }
  if (media.format === "silk") return undefined;
  const mime =
    media.format === "mp3" || media.format === "mpeg"
      ? "audio/mpeg"
      : media.format === "wav"
        ? "audio/wav"
        : "audio/mpeg";
  return { dataUrl: `data:${mime};base64,${media.data}` };
}

async function resolveVoiceAudio(
  client: WeChatClient,
  chatId: string,
  msg: Message,
): Promise<MimoAudioInput | undefined> {
  if (msg.artifactRef) {
    const fromDisk = readArtifactAsAudio(msg.artifactRef);
    if (fromDisk) return fromDisk;
  }
  const media = await fetchMediaWithRetry(client, chatId, msg.localId);
  return mediaToAudio(media);
}

function wrapLine(body: string, isGroup: boolean, sender: string): string {
  if (!body) return isGroup ? `${sender}:` : "";
  return isGroup ? `${sender}: ${body}` : body;
}

function imageLine(
  isGroup: boolean,
  sender: string,
  captionText?: string,
): string {
  const body = captionText
    ? `（发了一张图：${captionText}）`
    : "（发了一张图）";
  return wrapLine(body, isGroup, sender);
}

function voiceLine(
  isGroup: boolean,
  sender: string,
  captionText?: string,
): string {
  const body = captionText
    ? `（发了一条语音：${captionText}）`
    : "（发了一条语音）";
  return wrapLine(body, isGroup, sender);
}

function videoLine(
  isGroup: boolean,
  sender: string,
  captionsDir: string,
  localId: number,
): string {
  const cap = readCaption(captionsDir, localId);
  const body = cap ? `（发了一个视频：${cap}）` : "（发了一个视频）";
  return wrapLine(body, isGroup, sender);
}

/** Rust clean_content 已把 appmsg 链转为 `[Link] title\\ndes\\nurl`。 */
function formatLinkContent(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("[Link]")) return text;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines[0]!.replace(/^\[Link\]\s*/, "").trim();
  const url = lines.find((l) => /^https?:\/\//i.test(l));
  const des = lines.find((l) => l !== lines[0] && l !== url);

  const parts: string[] = [];
  if (title) parts.push(`（分享链接：${title}）`);
  else parts.push("（分享链接）");
  if (des && des !== title) parts.push(des);
  if (url) parts.push(url);
  return parts.join("\n");
}

function isLinkMessage(msg: Message): boolean {
  const baseType = msg.type & 0x7fffffff;
  const content = msg.content?.trim() ?? "";
  return (
    baseType === WECHAT_TYPE_APPMSG ||
    content.startsWith("[Link]") ||
    /^https?:\/\//i.test(content)
  );
}

export async function resolveMessageMultimodal(
  client: WeChatClient,
  chatId: string,
  msg: Message,
  isGroup: boolean,
  captionsDir: string,
): Promise<{
  line: string;
  images: ImageContent[];
  audios: MimoAudioInput[];
  hasVoiceWithCaption: boolean;
}> {
  const sender = msg.senderName ?? msg.sender ?? "unknown";
  const baseType = msg.type & 0x7fffffff;

  if (baseType === WECHAT_TYPE_IMAGE || msg.mediaKind === "image") {
    if (msg.artifactRef) {
      const img = readArtifactAsImage(msg.artifactRef);
      if (img) {
        const cap = await resolveImageCaptionSync(
          chatId,
          captionsDir,
          msg.localId,
          img.mimeType,
          img.data,
        );
        scheduleImageCaption(
          captionsDir,
          msg.localId,
          img.mimeType,
          img.data,
          chatId,
        );
        return {
          line: imageLine(isGroup, sender, cap),
          images: [img],
          audios: [],
          hasVoiceWithCaption: false,
        };
      }
    }
    const media = await fetchMediaWithRetry(client, chatId, msg.localId);
    const img = mediaToImage(media);
    if (img) {
      const cap = await resolveImageCaptionSync(
        chatId,
        captionsDir,
        msg.localId,
        img.mimeType,
        img.data,
      );
      scheduleImageCaption(
        captionsDir,
        msg.localId,
        img.mimeType,
        img.data,
        chatId,
      );
      return {
        line: imageLine(isGroup, sender, cap),
        images: [img],
        audios: [],
        hasVoiceWithCaption: false,
      };
    }
    return {
      line: wrapLine("（发了一张图，但这边没加载出来）", isGroup, sender),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }

  if (baseType === WECHAT_TYPE_VOICE || msg.mediaKind === "voice") {
    const audio = await resolveVoiceAudio(client, chatId, msg);
    if (audio) {
      const cap = await resolveVoiceCaptionSync(
        chatId,
        captionsDir,
        msg.localId,
        audio.dataUrl,
      );
      scheduleVoiceCaption(captionsDir, msg.localId, audio.dataUrl, chatId);
      return {
        line: voiceLine(isGroup, sender, cap),
        images: [],
        audios: [audio],
        hasVoiceWithCaption: true,
      };
    }
    const cap = ensureCaptionSync(captionsDir, msg.localId, "voice");
    return {
      line: voiceLine(isGroup, sender, cap),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }

  if (baseType === WECHAT_TYPE_EMOJI || msg.mediaKind === "emoji") {
    const media = await fetchMediaWithRetry(client, chatId, msg.localId);
    const img = mediaToImage(media);
    if (img) {
      return {
        line: wrapLine("（发了一个表情）", isGroup, sender),
        images: [img],
        audios: [],
        hasVoiceWithCaption: false,
      };
    }
    const text = msg.content?.trim() || "[emoji]";
    return {
      line: wrapLine(`（发了一个表情：${text}）`, isGroup, sender),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }

  if (baseType === WECHAT_TYPE_VIDEO || msg.mediaKind === "video") {
    ensureCaptionSync(captionsDir, msg.localId, "video");
    const media = await fetchMediaWithRetry(client, chatId, msg.localId);
    if (media.type === "video" && media.data && media.format !== "mp4") {
      const mime = media.format === "png" ? "image/png" : "image/jpeg";
      scheduleVideoCoverCaption(
        captionsDir,
        msg.localId,
        mime,
        media.data,
        chatId,
      );
      return {
        line: videoLine(isGroup, sender, captionsDir, msg.localId),
        images: [],
        audios: [],
        hasVoiceWithCaption: false,
      };
    }
    if (media.type === "video" && media.format === "mp4") {
      return {
        line: videoLine(isGroup, sender, captionsDir, msg.localId),
        images: [],
        audios: [],
        hasVoiceWithCaption: false,
      };
    }
    return {
      line: wrapLine("（发了一个视频，但这边没加载出来）", isGroup, sender),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }

  const text = msg.content?.trim() ?? "";
  if (isLinkMessage(msg) && text) {
    return {
      line: wrapLine(formatLinkContent(text), isGroup, sender),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }

  if (!text) {
    return {
      line: wrapLine("", isGroup, sender),
      images: [],
      audios: [],
      hasVoiceWithCaption: false,
    };
  }
  return {
    line: wrapLine(text, isGroup, sender),
    images: [],
    audios: [],
    hasVoiceWithCaption: false,
  };
}

export async function formatIncomingBatchMultimodal(
  client: WeChatClient,
  chatId: string,
  _chatName: string,
  isGroup: boolean,
  messages: Message[],
  captionsDir: string,
): Promise<MultimodalBatch> {
  const lines: string[] = [];
  const images: ImageContent[] = [];
  const audios: MimoAudioInput[] = [];
  let hasVoiceWithCaption = false;

  for (const msg of messages) {
    const resolved = await resolveMessageMultimodal(
      client,
      chatId,
      msg,
      isGroup,
      captionsDir,
    );
    if (resolved.line) lines.push(resolved.line);
    images.push(...resolved.images);
    audios.push(...resolved.audios);
    if (resolved.hasVoiceWithCaption) hasVoiceWithCaption = true;
  }

  const body = lines.join("\n");
  const text = isGroup ? body : `（对方新消息）\n${body}`;

  return { text, images, audios, userLines: lines, hasVoiceWithCaption };
}
