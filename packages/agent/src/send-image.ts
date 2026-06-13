import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { MediaResult, WeChatClient } from "@cococat/shared";
import { resolveArtifactPath } from "@cococat/shared";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type SendImagePayload = {
  data: string;
  mimeType: string;
  /** 写入 transcript / memory 的占位行 */
  label: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatToMime(format: string): string {
  switch (format.toLowerCase()) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    default:
      return "image/jpeg";
  }
}

function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

function labelForMediaType(type: MediaResult["type"]): string {
  return type === "emoji" ? "（发了一个表情）" : "（发了一张图）";
}

function payloadFromBytes(
  bytes: Buffer,
  mimeType: string,
  label: string,
): SendImagePayload {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（>${MAX_IMAGE_BYTES} 字节）`);
  }
  return {
    data: bytes.toString("base64"),
    mimeType,
    label,
  };
}

function payloadFromPath(
  rawPath: string,
  label = "（发了一张图）",
): SendImagePayload {
  const filePath = resolvePath(rawPath);
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const st = statSync(filePath);
  if (!st.isFile()) {
    throw new Error(`不是文件: ${filePath}`);
  }
  if (st.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（>${MAX_IMAGE_BYTES} 字节）`);
  }
  const bytes = readFileSync(filePath);
  return payloadFromBytes(bytes, mimeFromPath(filePath), label);
}

async function payloadFromUrl(
  url: string,
  format: string,
  mediaType: MediaResult["type"],
): Promise<SendImagePayload> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载表情/图片失败: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    formatToMime(format);
  return payloadFromBytes(buf, mimeType, labelForMediaType(mediaType));
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

async function payloadFromMediaResult(
  client: WeChatClient,
  chatId: string,
  localId: number,
): Promise<SendImagePayload> {
  const media = await fetchMediaWithRetry(client, chatId, localId);

  if (media.type !== "image" && media.type !== "emoji") {
    throw new Error(`localId 对应消息不是图片/表情（type=${media.type}）`);
  }

  const label = labelForMediaType(media.type);

  if (media.artifactRef) {
    const artifactPath = resolveArtifactPath(media.artifactRef);
    if (existsSync(artifactPath)) {
      return payloadFromPath(artifactPath, label);
    }
  }

  if (media.data) {
    const bytes = Buffer.from(media.data, "base64");
    return payloadFromBytes(bytes, formatToMime(media.format), label);
  }

  if (media.url) {
    return payloadFromUrl(media.url, media.format, media.type);
  }

  throw new Error("无法读取该消息的媒体数据");
}

/** 解析待发图片：聊天记录 localId 或宿主机路径。 */
export async function resolveSendImagePayload(
  client: WeChatClient,
  chatId: string,
  params: { localId?: number; path?: string },
): Promise<SendImagePayload> {
  const hasLocalId = params.localId !== undefined && !Number.isNaN(params.localId);
  const path = params.path?.trim();

  if (hasLocalId && path) {
    throw new Error("请只提供 localId 或 path 之一");
  }
  if (!hasLocalId && !path) {
    throw new Error("需要 localId（聊天里的图片/表情）或 path（本地 png/gif）");
  }

  if (path) {
    return payloadFromPath(path);
  }

  return payloadFromMediaResult(client, chatId, params.localId!);
}
