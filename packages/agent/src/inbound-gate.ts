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
import {
  isAgentProxyEnabled,
  isServicePersona,
  loadChatStyleCached,
} from "./style.js";

export type InboundGateDiscardReason =
  | ReplySkipReason
  | "official_account"
  | "group_buffer"
  | "muted_customer"
  | "agent_proxy_off"
  | "triage_done"
  | "memory_unavailable"
  | "cooling_down_deferred";

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
};

/** WeChat official/service accounts use `gh_` usernames. They are read-only for Agent auto-reply. */
export function isOfficialAccountChat(chatId: string): boolean {
  return chatId.startsWith("gh_");
}

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
  } = params;

  const isGroupChat = isGroup || chatId.includes("@chatroom");
  const isPrivateService = !isGroupChat && isServicePersona(chatCtx.style);
  const isMaintainerChannel =
    !isGroupChat && Boolean(escalation?.isMaintainerChat(chatId));

  if (!isGroupChat && isOfficialAccountChat(chatId)) {
    return {
      action: "discard",
      reason: "official_account",
      unseen: initialUnseen,
      shouldMarkSeen: true,
    };
  }

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

  if (!isGroupChat && !isMaintainerChannel) {
    const liveStyle = loadChatStyleCached(chatCtx.stylePath);
    if (!isAgentProxyEnabled(liveStyle)) {
      return {
        action: "discard",
        reason: "agent_proxy_off",
        unseen: initialUnseen,
        shouldMarkSeen: true,
      };
    }
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

  if (isPrivateService && memoryHealth && !isMaintainerChannel) {
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

  if (isPrivateService && escalation && !isMaintainerChannel) {
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

  const skipReason = evaluateReplySkip({
    chatId,
    cooldownMs: replyCooldownMs(chatCtx.style.replyCooldownMs),
    wasMentioned,
  });
  if (skipReason === "cooling_down") {
    // Fast path: defer to full path — fast-discard will see this reason and
    // return undefined (let processUnseen's full-mode gate re-evaluate).
    if (mode === "fast") {
      return {
        action: "discard",
        reason: "cooling_down_deferred",
        unseen,
        shouldMarkSeen: false,
      };
    }
    // Full path: discard now. Private service persona skips markSeen so the
    // message re-enters the unseen queue on next poll (preserves the old
    // inline-guard behavior from session.ts:838-844).
    const shouldMarkSeen = !isPrivateService;
    return {
      action: "discard",
      reason: "cooling_down",
      unseen,
      shouldMarkSeen,
    };
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
