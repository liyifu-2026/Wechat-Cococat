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

const KNOWLEDGE_GAP_REPLY_PATTERNS = [
  /没[有]?(现成|完整)?(教程|资料|方案|文档|记录)/u,
  /手头没[有]?/u,
  /不太确定/u,
  /不能确定/u,
  /我(帮你|帮您)?(查查|查一下|确认一下|问一下)/u,
  /需要.*(人工|同事|维护|确认)/u,
];

const FACT_QUESTION_PATTERNS = [
  /怎么办/u,
  /怎么(弄|处理|解决|操作|安装|配置|维修|施工|做)/u,
  /(教程|流程|步骤|方案|打不开|报错|故障|防水|涂层|施工|装修)/u,
  /(为什么|如何|哪里|哪个|多少|是否|能不能)/u,
];

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

export function shouldNotifyMaintainerForKnowledgeGap(params: {
  userLines: string[];
  sentTexts: string[];
  wikiHits: string[];
}): boolean {
  if (params.userLines.length === 0 || params.sentTexts.length === 0) {
    return false;
  }
  const userText = params.userLines.join("\n");
  const sentText = params.sentTexts.join("\n");
  const asksFactQuestion = FACT_QUESTION_PATTERNS.some((re) =>
    re.test(userText),
  );
  const replyShowsGap = KNOWLEDGE_GAP_REPLY_PATTERNS.some((re) =>
    re.test(sentText),
  );
  return asksFactQuestion && replyShowsGap && params.wikiHits.length === 0;
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
      const knowledgeGap = shouldNotifyMaintainerForKnowledgeGap({
        userLines: userPreview,
        sentTexts,
        wikiHits: hits,
      });
      if (knowledgeGap) {
        await escalation.maybeNotifyLowConfidence({
          chatId: chatCtx.chatId,
          chatName,
          confidence: 0,
          userLines: userPreview,
        });
      } else {
        await escalation.maybeNotifyLowConfidence({
          chatId: chatCtx.chatId,
          chatName,
          confidence: lastTriageConfidence,
          userLines: userPreview,
        });
      }
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
