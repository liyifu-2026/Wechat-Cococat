import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message, WeChatClient } from "@cococat/shared";
import { applyDelay } from "./delays.js";
import { stripReasoningLeaks } from "./reasoning.js";
import { humanizeReplyText } from "./humanize.js";
import { stripLeadingAtMentions } from "./mention-names.js";
import { resolveSendImagePayload } from "./send-image.js";
import { prepareServiceOutboundText } from "./stealth-send.js";
import type { DelayRange } from "./style.js";

export const WECHAT_OUTBOUND_TOOL_NAMES = new Set([
  "wechat_send_message",
  "wechat_send_image",
]);

export const MAX_SENDS_HARD_LIMIT = 5;

const SEND_RETRY_DELAYS_MS = [100, 500, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrySend(
  fn: () => Promise<unknown>,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt <= SEND_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt < SEND_RETRY_DELAYS_MS.length) {
        console.warn(
          `[pi-wechat] ${label} attempt ${attempt + 1} failed, retrying in ${SEND_RETRY_DELAYS_MS[attempt]}ms:`,
          err,
        );
        await sleep(SEND_RETRY_DELAYS_MS[attempt]!);
      } else {
        throw err;
      }
    }
  }
}

export type WeChatToolContext = {
  client: WeChatClient;
  chatId: string;
  isGroup: boolean;
  sendCountRef: { current: number };
  sentTextsRef: { current: string[] };
  burstDelayMs: DelayRange;
  replyMentionsRef: { current: string[] | undefined };
  maxSendsPerTurn: number;
  stealthRetriedRef?: { current: boolean };
  serviceStealthEnabled?: boolean;
};

function formatListLine(msg: Message, isGroup: boolean): string {
  const baseType = msg.type & 0x7fffffff;
  if (baseType === 3 || msg.mediaKind === "image") {
    return isGroup
      ? `${msg.senderName ?? msg.sender ?? "unknown"}: （发了一张图）`
      : "（发了一张图）";
  }
  if (baseType === 34 || msg.mediaKind === "voice") {
    return isGroup
      ? `${msg.senderName ?? msg.sender ?? "unknown"}: （发了一条语音）`
      : "（发了一条语音）";
  }
  if (baseType === 43 || msg.mediaKind === "video") {
    return isGroup
      ? `${msg.senderName ?? msg.sender ?? "unknown"}: （发了一个视频）`
      : "（发了一个视频）";
  }
  if (baseType === 47 || msg.mediaKind === "emoji") {
    return isGroup
      ? `${msg.senderName ?? msg.sender ?? "unknown"}: （发了一个表情） localId=${msg.localId}`
      : `（发了一个表情） localId=${msg.localId}`;
  }
  const text = msg.content?.trim() ?? "";
  if (msg.isSelf) return `我: ${text}`;
  if (isGroup) {
    const name = msg.senderName ?? msg.sender ?? "unknown";
    return `${name}: ${text}`;
  }
  return text;
}

export function createWeChatTools(ctx: WeChatToolContext): AgentTool[] {
  const sendMessage: AgentTool = {
    name: "wechat_send_message",
    label: "发微信",
    description:
      "在当前聊天发一条文字。默认每轮 1 条；需要时可连发最多 5 条。",
    parameters: Type.Object({
      text: Type.String({ description: "要发送的文字" }),
    }),
    execute: async (_toolCallId, params) => {
      if (ctx.sendCountRef.current > 0) {
        await applyDelay(ctx.burstDelayMs);
      }

      const { text } = params as { text: string };
      let cleaned = humanizeReplyText(stripReasoningLeaks(text));
      if (ctx.serviceStealthEnabled && ctx.stealthRetriedRef) {
        const prepared = prepareServiceOutboundText(
          cleaned,
          ctx.stealthRetriedRef,
        );
        if (prepared.ok) {
          cleaned = prepared.text;
        } else if (!prepared.retry) {
          cleaned = prepared.text;
        }
      }
      const allMentions = ctx.replyMentionsRef.current;
      const mentionsForSend =
        ctx.sendCountRef.current === 0 ? allMentions : undefined;
      const body =
        mentionsForSend && mentionsForSend.length > 0
          ? stripLeadingAtMentions(cleaned, mentionsForSend)
          : cleaned;

      await retrySend(
        () =>
          ctx.client.sendMessage({
            chatId: ctx.chatId,
            text: body,
            mentions: mentionsForSend,
          }),
        `sendMessage to ${ctx.chatId}`,
      );
      ctx.sendCountRef.current += 1;
      ctx.sentTextsRef.current.push(body);

      return {
        content: [{ type: "text" as const, text: "ok" }],
        details: { chatId: ctx.chatId, mentions: mentionsForSend },
      };
    },
  };

  const sendImage: AgentTool = {
    name: "wechat_send_image",
    label: "发表情/图片",
    description:
      "在当前聊天发一张图片或表情包（gif/png/jpeg）。可引用本聊天 wechat_list_messages 里看到的 localId（图片/表情消息），或宿主机本地图片路径。计入每轮发送条数。",
    parameters: Type.Object({
      localId: Type.Optional(
        Type.Number({
          description: "本聊天中图片/表情消息的 localId",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description: "宿主机本地图片路径（如 ~/.local/share/.../emoji.gif）",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      if (ctx.sendCountRef.current > 0) {
        await applyDelay(ctx.burstDelayMs);
      }

      const { localId, path } = params as { localId?: number; path?: string };
      const payload = await resolveSendImagePayload(ctx.client, ctx.chatId, {
        localId,
        path,
      });

      await retrySend(
        () =>
          ctx.client.sendMessage({
            chatId: ctx.chatId,
            image: { data: payload.data, mimeType: payload.mimeType },
          }),
        `sendImage to ${ctx.chatId}`,
      );
      ctx.sendCountRef.current += 1;
      ctx.sentTextsRef.current.push(payload.label);

      return {
        content: [{ type: "text" as const, text: "ok" }],
        details: {
          chatId: ctx.chatId,
          mimeType: payload.mimeType,
          localId,
          path,
        },
      };
    },
  };

  const listMessages: AgentTool = {
    name: "wechat_list_messages",
    label: "翻聊天记录",
    description: "上下文不够时再翻最近消息；不要频繁调用。",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "条数，默认 30" })),
    }),
    execute: async (_toolCallId, params) => {
      const { limit } = params as { limit?: number };
      const rawLimit = Number(limit ?? 30);
      const safeLimit = Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
        : 30;
      const messages = await ctx.client.listMessages(ctx.chatId, safeLimit);
      const lines = messages.map((m) => formatListLine(m, ctx.isGroup));
      return {
        content: [
          { type: "text" as const, text: lines.join("\n") || "(无消息)" },
        ],
        details: { count: messages.length },
      };
    },
  };

  return [sendMessage, sendImage, listMessages];
}

export function resolveMaxSendsPerTurn(styleMax: number | undefined): number {
  const raw = styleMax ?? 1;
  return Math.min(MAX_SENDS_HARD_LIMIT, Math.max(1, raw));
}
