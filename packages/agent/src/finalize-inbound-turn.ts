import type { PiWeChatConfig } from "./config.js";
import type { ChatContext } from "./chat-store.js";
import type { EscalationService } from "./escalation/service.js";
import type { GroupPolicy } from "./group-config.js";
import { updateChatMeta } from "./chat-store.js";
import { clearGroupBuffer } from "./group-reply-policy.js";
import { appendConsoleEvent } from "./console-events.js";
import {
  appendTurnToTranscript,
  loadTranscript,
} from "./transcript.js";
import { recordAutoReply } from "./reply-guard.js";
import { readWikiHits } from "./wiki-hit-store.js";
import type { Message } from "@cococat/shared";

export type FinalizeInboundTurnParams = {
  chatCtx: ChatContext;
  config: PiWeChatConfig;
  chatName: string;
  isGroupChat: boolean;
  unseen: Message[];
  userLines: string[];
  sentTexts: string[];
  groupPolicy: GroupPolicy;
  groupBuffers: Map<string, Message[]>;
  escalation?: EscalationService;
  lastTriageConfidence?: number;
  /** Outbound thoughtful: user lines already appended at offload time. */
  assistantOnlyTranscript?: boolean;
  userLocalIds?: number[];
};

function previewLinesFromUnseen(messages: Message[]): string[] {
  return messages
    .map((m) => m.content?.trim() ?? "")
    .filter(Boolean);
}

/** Post-turn persistence shared by sync inbound and outbound thoughtful paths. */
export async function finalizeInboundTurn(
  params: FinalizeInboundTurnParams,
): Promise<void> {
  const {
    chatCtx,
    config,
    chatName,
    isGroupChat,
    unseen,
    userLines,
    sentTexts,
    groupPolicy,
    groupBuffers,
    escalation,
    lastTriageConfidence,
    assistantOnlyTranscript,
    userLocalIds,
  } = params;

  const limit = chatCtx.style.historyLimit ?? config.historyLimit;
  appendTurnToTranscript(
    chatCtx.transcriptPath,
    loadTranscript(chatCtx.transcriptPath),
    assistantOnlyTranscript ? [] : userLines,
    sentTexts,
    limit,
    userLocalIds ?? unseen.map((m) => m.localId),
  );

  const maxLocalId = unseen.reduce(
    (max, m) => (m.localId > max ? m.localId : max),
    chatCtx.meta.lastLocalId ?? 0,
  );
  updateChatMeta(chatCtx, { lastLocalId: maxLocalId });

  await config.memoryClient?.capture(chatCtx.chatId, {
    userLines,
    assistantLines: sentTexts,
  });
  await config.memoryClient?.syncPersonaL3(
    chatCtx.chatId,
    chatCtx.personaPath,
  );

  if (sentTexts.length > 0) {
    recordAutoReply(chatCtx.chatId);
  }

  if (!isGroupChat && sentTexts.length > 0) {
    const userPreview = previewLinesFromUnseen(unseen);
    const hits = readWikiHits(chatCtx.chatId);
    appendConsoleEvent({
      kind: "auto_reply",
      chatId: chatCtx.chatId,
      chatName,
      topic: hits[0] ?? userPreview[0]?.slice(0, 48),
    });
    if (escalation?.isEnabled()) {
      await escalation.maybeNotifyLowConfidence({
        chatId: chatCtx.chatId,
        chatName,
        confidence: lastTriageConfidence,
        userLines: userPreview,
      });
    }
  }

  if (isGroupChat && !groupPolicy.requireMention) {
    clearGroupBuffer(groupBuffers, chatCtx.chatId);
  }
}

/** Proactive / scheduled turns: record auto-reply when something was sent. */
export function finalizeProactiveTurn(params: {
  chatCtx: ChatContext;
  sentTexts: string[];
}): void {
  if (params.sentTexts.length > 0) {
    recordAutoReply(params.chatCtx.chatId);
  }
}
