import type { ImageContent } from "@earendil-works/pi-ai";
import type { Message, WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "./config.js";
import type { ChatContext } from "./chat-store.js";
import { appendAgentTrace } from "./agent-trace.js";
import { formatIncomingBatchMultimodal } from "./media.js";
import type { MimoAudioInput } from "./mimo-audio.js";
import { buildSystemPrompt, resolveWikiScopePrompt } from "./system-prompt.js";
import { resolveCustomerContextPrompt } from "./customer-context-prompt.js";

export type EnrichedInbound = {
  prompt: string;
  images: ImageContent[];
  audios: MimoAudioInput[];
  userLines: string[];
  hasVoiceWithCaption: boolean;
};

export async function enrichInboundMessages(params: {
  client: WeChatClient;
  chatCtx: ChatContext;
  chatName: string;
  isGroupChat: boolean;
  unseen: Message[];
}): Promise<EnrichedInbound> {
  const { client, chatCtx, chatName, isGroupChat, unseen } = params;
  const { text, images, audios, userLines, hasVoiceWithCaption } =
    await formatIncomingBatchMultimodal(
      client,
      chatCtx.chatId,
      chatName,
      isGroupChat,
      unseen,
      chatCtx.captionsDir,
    );
  return {
    prompt: text,
    images,
    audios,
    userLines,
    hasVoiceWithCaption,
  };
}

export function traceInboundEnrichment(params: {
  chatId: string;
  chatName: string;
  turnId: string;
  isGroupChat: boolean;
  wasMentioned: boolean;
  injectedBufferCount: number;
  enriched: EnrichedInbound;
  queryLabel?: string;
}): void {
  const { enriched, queryLabel } = params;
  appendAgentTrace({
    chatId: params.chatId,
    chatName: params.chatName,
    turnId: params.turnId,
    phase: "inbound",
    query:
      queryLabel ??
      [
        params.isGroupChat ? "群聊" : "私聊",
        params.wasMentioned ? "@提及" : "无@",
        params.injectedBufferCount > 0
          ? `注入buffer ${params.injectedBufferCount}`
          : null,
        enriched.audios.length > 0 ? `语音×${enriched.audios.length}` : null,
        enriched.images.length > 0 ? `图片×${enriched.images.length}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    detail: [
      "【用户】",
      enriched.userLines.join("\n") || "(无文本)",
      "",
      "【送入模型 prompt 摘要】",
      enriched.prompt.slice(0, 2000),
    ].join("\n"),
  });
}

export async function prepareInboundMemoryContext(params: {
  config: PiWeChatConfig;
  chatCtx: ChatContext;
  chatName: string;
  isGroupChat: boolean;
  turnId: string;
  userLines: string[];
  audios: MimoAudioInput[];
  hasVoiceWithCaption: boolean;
  pendingSystemRef: { current: string };
  pendingAudiosRef: { current: MimoAudioInput[] };
  pendingVoiceCaptionRef: { current: boolean };
  envOverride?: string;
  agentHandoffEnabled?: boolean;
}): Promise<void> {
  const {
    config,
    chatCtx,
    chatName,
    isGroupChat,
    turnId,
    userLines,
    audios,
    hasVoiceWithCaption,
    pendingSystemRef,
    pendingAudiosRef,
    pendingVoiceCaptionRef,
    envOverride,
    agentHandoffEnabled,
  } = params;

  const recallQuery = userLines.join("\n").slice(0, 500);
  const longTermMemory = await config.memoryClient?.recall(
    chatCtx.chatId,
    recallQuery,
  );
  if (longTermMemory?.trim()) {
    appendAgentTrace({
      chatId: chatCtx.chatId,
      chatName,
      turnId,
      phase: "memory",
      query: recallQuery.slice(0, 200),
      detail: longTermMemory,
    });
  }

  pendingSystemRef.current = buildSystemPrompt({
    chatId: chatCtx.chatId,
    chatName,
    isGroup: isGroupChat,
    personaPath: chatCtx.personaPath,
    envOverride: envOverride ?? config.systemPrompt,
    wikiEnabled: config.wikiEnabled,
    wikiScopePrompt: resolveWikiScopePrompt(
      config.wikiEnabled,
      chatCtx.wiki.projects,
      config.wikiClient?.getRegistry(),
    ),
    longTermMemory,
    agentHandoffEnabled: agentHandoffEnabled === true,
    customerContextPrompt: isGroupChat
      ? ""
      : resolveCustomerContextPrompt(chatCtx.chatId),
  });

  if (audios.length > 0) {
    console.log(
      `[pi-wechat] ${chatName}: ${audios.length} voice clip(s) → mimo-v2.5 audio`,
    );
  }

  pendingAudiosRef.current = audios;
  pendingVoiceCaptionRef.current = hasVoiceWithCaption;
}
