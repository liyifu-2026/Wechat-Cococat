import type { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { Message, WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "./config.js";
import { updateChatMeta, type ChatContext } from "./chat-store.js";
import { appendAgentTrace } from "./agent-trace.js";
import type { MimoAudioInput } from "./mimo-audio.js";
import { stripReasoningFromAgent } from "./reasoning.js";
import { sendAssistantTextFallback } from "./reply.js";
import {
  buildOutboundMentions,
  clearGroupBuffer,
  type GroupPolicy,
} from "./group-reply-policy.js";
import {
  enrichInboundMessages,
  prepareInboundMemoryContext,
  traceInboundEnrichment,
} from "./inbound-turn-enrich.js";
import { enqueueInboundThoughtfulReply } from "./queue/enqueue-thoughtful.js";
import {
  appendTurnToTranscript,
  loadTranscript,
} from "./transcript.js";
import { shouldOffloadThoughtfulToOutbound } from "./thoughtful.js";
import type { AgentHandoffTurnRef } from "./escalation/agent-handoff.js";
import { isServicePersona } from "./style.js";

export type InboundTurnRefs = {
  sendCountRef: { current: number };
  sentTextsRef: { current: string[] };
  replyMentionsRef: { current: string[] | undefined };
  pendingSystemRef: { current: string };
  pendingAudiosRef: { current: MimoAudioInput[] };
  pendingVoiceCaptionRef: { current: boolean };
  stealthRetriedRef?: { current: boolean };
  agentHandoffEnabled?: boolean;
  handoffTurnRef?: AgentHandoffTurnRef;
};

export type RunInboundTurnParams = {
  client: WeChatClient;
  config: PiWeChatConfig;
  chatCtx: ChatContext;
  agent: Agent;
  chatName: string;
  isGroupChat: boolean;
  unseen: Message[];
  wasMentioned: boolean;
  groupPolicy: GroupPolicy;
  injectedBufferCount: number;
  turnId: string;
  groupBuffers: Map<string, Message[]>;
  maxSendsPerTurn: number;
  runPromptTurn: (
    prompt: string,
    images: ImageContent[],
    opts: {
      userLines: string[];
      chatName: string;
    },
  ) => Promise<void>;
  traceReplySummary: (chatName: string) => void;
} & InboundTurnRefs;

export type RunInboundTurnResult =
  | { status: "thoughtful_offloaded" }
  | { status: "completed"; userLines: string[]; sentTexts: string[] };

export type RunThoughtfulInboundTurnParams = {
  client: WeChatClient;
  config: PiWeChatConfig;
  chatCtx: ChatContext;
  agent: Agent;
  chatName: string;
  isGroupChat: boolean;
  unseen: Message[];
  turnId: string;
  replyMentions?: string[];
  maxSendsPerTurn: number;
  runThoughtfulTurn: (
    prompt: string,
    images: ImageContent[],
  ) => Promise<void>;
  traceReplySummary: (chatName: string) => void;
} & InboundTurnRefs;

function resetTurnRefs(
  refs: InboundTurnRefs,
  isGroupChat: boolean,
  unseen: Message[],
  groupPolicy: GroupPolicy,
  replyMentions?: string[],
): void {
  refs.sendCountRef.current = 0;
  refs.sentTextsRef.current = [];
  refs.replyMentionsRef.current =
    replyMentions ??
    buildOutboundMentions(isGroupChat, unseen, groupPolicy);
}

/** Gate 之后：enrich → thoughtful offload 或 prompt → send。 */
export async function runInboundTurn(
  params: RunInboundTurnParams,
): Promise<RunInboundTurnResult> {
  const {
    client,
    config,
    chatCtx,
    agent,
    chatName,
    isGroupChat,
    unseen,
    wasMentioned,
    groupPolicy,
    injectedBufferCount,
    turnId,
    groupBuffers,
    maxSendsPerTurn,
    runPromptTurn,
    traceReplySummary,
  } = params;

  resetTurnRefs(params, isGroupChat, unseen, groupPolicy);

  if (params.replyMentionsRef.current) {
    console.log(
      `[pi-wechat] ${chatName}: reply mentions ${params.replyMentionsRef.current.join(", ")}`,
    );
  }

  const enriched = await enrichInboundMessages({
    client,
    chatCtx,
    chatName,
    isGroupChat,
    unseen,
  });

  traceInboundEnrichment({
    chatId: chatCtx.chatId,
    chatName,
    turnId,
    isGroupChat,
    wasMentioned,
    injectedBufferCount,
    enriched,
  });

  if (
    shouldOffloadThoughtfulToOutbound(
      config.queueEnabled,
      chatCtx.style,
      enriched.userLines,
    )
  ) {
    console.log(
      `[pi-wechat] ${chatName}: thoughtful → outbound queue (${unseen.length} msg)`,
    );
    appendAgentTrace({
      chatId: chatCtx.chatId,
      chatName,
      turnId,
      phase: "queue",
      query: "thoughtful → outbound",
      detail:
        enriched.userLines.join("\n") || enriched.prompt.slice(0, 1000),
    });
    await enqueueInboundThoughtfulReply({
      chatId: chatCtx.chatId,
      chatName,
      isGroup: isGroupChat,
      userLocalIds: unseen.map((m) => m.localId),
      replyMentions: params.replyMentionsRef.current,
    });

    const limit = chatCtx.style.historyLimit ?? config.historyLimit;
    appendTurnToTranscript(
      chatCtx.transcriptPath,
      loadTranscript(chatCtx.transcriptPath),
      enriched.userLines,
      [],
      limit,
      unseen.map((m) => m.localId),
    );

    const maxLocalId = unseen.reduce(
      (max, m) => (m.localId > max ? m.localId : max),
      chatCtx.meta.lastLocalId ?? 0,
    );
    updateChatMeta(chatCtx, { lastLocalId: maxLocalId });

    if (isGroupChat && !groupPolicy.requireMention) {
      clearGroupBuffer(groupBuffers, chatCtx.chatId);
    }

    return { status: "thoughtful_offloaded" };
  }

  await prepareInboundMemoryContext({
    config,
    chatCtx,
    chatName,
    isGroupChat,
    turnId,
    userLines: enriched.userLines,
    audios: enriched.audios,
    hasVoiceWithCaption: enriched.hasVoiceWithCaption,
    pendingSystemRef: params.pendingSystemRef,
    pendingAudiosRef: params.pendingAudiosRef,
    pendingVoiceCaptionRef: params.pendingVoiceCaptionRef,
    agentHandoffEnabled: params.agentHandoffEnabled,
  });

  if (params.handoffTurnRef) {
    params.handoffTurnRef.userLines = enriched.userLines;
  }

  await runPromptTurn(enriched.prompt, enriched.images, {
    userLines: enriched.userLines,
    chatName,
  });

  stripReasoningFromAgent(agent);

  const fallbackSent = await sendAssistantTextFallback(
    agent,
    client,
    chatCtx.chatId,
    params.sendCountRef.current,
    params.replyMentionsRef.current,
    chatCtx.style.burstDelayMs,
    maxSendsPerTurn,
    {
      serviceStealthEnabled: isServicePersona(chatCtx.style),
      stealthRetriedRef: params.stealthRetriedRef,
    },
  );
  params.sentTextsRef.current.push(...fallbackSent);
  traceReplySummary(chatName);

  return {
    status: "completed",
    userLines: enriched.userLines,
    sentTexts: params.sentTextsRef.current,
  };
}

/** Outbound queue：入站 thoughtful 两阶段回复。 */
export async function runThoughtfulInboundTurn(
  params: RunThoughtfulInboundTurnParams,
): Promise<{ userLines: string[]; sentTexts: string[] }> {
  const {
    client,
    config,
    chatCtx,
    agent,
    chatName,
    isGroupChat,
    unseen,
    turnId,
    maxSendsPerTurn,
    runThoughtfulTurn,
    traceReplySummary,
  } = params;

  params.sendCountRef.current = 0;
  params.sentTextsRef.current = [];
  params.replyMentionsRef.current = params.replyMentions;

  const enriched = await enrichInboundMessages({
    client,
    chatCtx,
    chatName,
    isGroupChat,
    unseen,
  });

  traceInboundEnrichment({
    chatId: chatCtx.chatId,
    chatName,
    turnId,
    isGroupChat,
    wasMentioned: unseen.some((m) => m.isMentioned === true),
    injectedBufferCount: 0,
    enriched,
    queryLabel: `outbound thoughtful · 语音×${enriched.audios.length}`,
  });

  await prepareInboundMemoryContext({
    config,
    chatCtx,
    chatName,
    isGroupChat,
    turnId,
    userLines: enriched.userLines,
    audios: enriched.audios,
    hasVoiceWithCaption: enriched.hasVoiceWithCaption,
    pendingSystemRef: params.pendingSystemRef,
    pendingAudiosRef: params.pendingAudiosRef,
    pendingVoiceCaptionRef: params.pendingVoiceCaptionRef,
    agentHandoffEnabled: params.agentHandoffEnabled,
  });

  if (params.handoffTurnRef) {
    params.handoffTurnRef.userLines = enriched.userLines;
  }

  await runThoughtfulTurn(enriched.prompt, enriched.images);

  stripReasoningFromAgent(agent);

  const fallbackSent = await sendAssistantTextFallback(
    agent,
    client,
    chatCtx.chatId,
    params.sendCountRef.current,
    params.replyMentionsRef.current,
    chatCtx.style.burstDelayMs,
    maxSendsPerTurn,
    {
      serviceStealthEnabled: isServicePersona(chatCtx.style),
      stealthRetriedRef: params.stealthRetriedRef,
    },
  );
  params.sentTextsRef.current.push(...fallbackSent);
  traceReplySummary(chatName);

  return {
    userLines: enriched.userLines,
    sentTexts: params.sentTextsRef.current,
  };
}
