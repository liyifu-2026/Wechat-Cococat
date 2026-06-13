import type { Message } from "@cococat/shared";
import type { ChatContext } from "./chat-store.js";
import type { GroupConfig, GroupPolicy } from "./group-config.js";
import type { EscalationService } from "./escalation/service.js";
import { applyGroupInbound } from "./group-reply-policy.js";
import {
  evaluateReplySkip,
  replyCooldownMs,
  type ReplySkipReason,
} from "./reply-guard.js";
import type { MemoryHealthMonitor } from "./memory-health.js";
import type { TranscriptEntry } from "./transcript.js";
import { isServicePersona } from "./style.js";

export type InboundGateDiscardReason =
  | ReplySkipReason
  | "group_buffer"
  | "muted_customer"
  | "triage_done"
  | "memory_unavailable";

export type InboundGateDiscard = {
  action: "discard";
  reason: InboundGateDiscardReason;
  unseen: Message[];
  /** memory_unavailable 时为 false — 调用方勿 markSeen */
  shouldMarkSeen: boolean;
};

export type InboundGateProceed = {
  action: "proceed";
  unseen: Message[];
  wasMentioned: boolean;
  groupPolicy: GroupPolicy;
  injectedBufferCount: number;
  lastTriageConfidence?: number;
};

export type InboundGateResult = InboundGateDiscard | InboundGateProceed;

export type InboundGateParams = {
  chatId: string;
  chatName: string;
  isGroup: boolean;
  unseen: Message[];
  group: GroupConfig;
  groupBuffers: Map<string, Message[]>;
  chatCtx: ChatContext;
  escalation?: EscalationService;
  memoryHealth?: MemoryHealthMonitor;
  transcriptEntries: TranscriptEntry[];
  mode: "fast" | "full";
  skipReplyGuard?: boolean;
};

/**
 * Shared inbound gate for sync and queue paths.
 * fast-discard uses mode=fast; processUnseen uses mode=full before hydrate.
 */
export async function evaluateInboundGate(
  params: InboundGateParams,
): Promise<InboundGateResult> {
  const {
    chatId,
    chatName,
    isGroup,
    unseen: initialUnseen,
    group,
    groupBuffers,
    chatCtx,
    escalation,
    memoryHealth,
    transcriptEntries,
    mode,
    skipReplyGuard,
  } = params;

  const isGroupChat = isGroup || chatId.includes("@chatroom");
  const isPrivateService = !isGroupChat && isServicePersona(chatCtx.style);

  if (
    !isGroupChat &&
    escalation?.isEnabled() &&
    escalation.shouldSkipMutedCustomer(chatId, chatName)
  ) {
    return {
      action: "discard",
      reason: "muted_customer",
      unseen: initialUnseen,
      shouldMarkSeen: true,
    };
  }

  const groupResult = applyGroupInbound({
    chatId,
    isGroup,
    unseen: initialUnseen,
    group,
    groupBuffers,
    chatCtx,
    mode,
  });

  if (groupResult.action === "buffer") {
    return {
      action: "discard",
      reason: "group_buffer",
      unseen: groupResult.unseen,
      shouldMarkSeen: true,
    };
  }

  let { unseen, wasMentioned, groupPolicy, injectedBufferCount } = groupResult;
  let lastTriageConfidence: number | undefined;

  if (isPrivateService && memoryHealth) {
    const memoryOk = await memoryHealth.requireAvailable();
    if (!memoryOk) {
      return {
        action: "discard",
        reason: "memory_unavailable",
        unseen,
        shouldMarkSeen: false,
      };
    }
  }

  if (isPrivateService && escalation) {
    const previewLines = unseen
      .map((m) => m.content?.trim() ?? "")
      .filter(Boolean);
    const triageOutcome = await escalation.applyUnifiedPrivateGate({
      chatId,
      chatName,
      messages: unseen,
      userLines: previewLines,
      transcriptEntries,
    });
    if (triageOutcome.status === "done") {
      return {
        action: "discard",
        reason: "triage_done",
        unseen,
        shouldMarkSeen: true,
      };
    }
    lastTriageConfidence = triageOutcome.confidence;
  }

  if (!skipReplyGuard) {
    const skipReason = evaluateReplySkip({
      chatId,
      cooldownMs: replyCooldownMs(chatCtx.style.replyCooldownMs),
      transcriptEntries,
      wasMentioned,
    });
    if (skipReason) {
      return {
        action: "discard",
        reason: skipReason,
        unseen,
        shouldMarkSeen: true,
      };
    }
  }

  return {
    action: "proceed",
    unseen,
    wasMentioned,
    groupPolicy,
    injectedBufferCount,
    lastTriageConfidence,
  };
}
