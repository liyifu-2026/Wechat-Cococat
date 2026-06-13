import type { Message, WeChatClient } from "@cococat/shared";
import { ensureChatContext } from "../chat-store.js";
import type { EscalationService } from "../escalation/service.js";
import type { GroupConfig } from "../group-config.js";
import { appendAgentTrace } from "../agent-trace.js";
import { evaluateInboundGate, type InboundGateDiscardReason } from "../inbound-gate.js";
import type { MemoryHealthMonitor } from "../memory-health.js";
import { loadTranscript } from "../transcript.js";

export type FastDiscardReason = InboundGateDiscardReason;

export type FastDiscardResult = {
  reason: FastDiscardReason;
  localIds: number[];
};

function snapshotMessages(
  all: Message[],
  snapshotLocalIds: number[],
): Message[] {
  const idSet = new Set(snapshotLocalIds);
  return all.filter((m) => !m.isSelf && idSet.has(m.localId));
}

/**
 * Worker 首行轻量丢弃：不进 ChatSession / hydrate / LLM。
 * 命中时调用方必须 markSeen(snapshot localIds)。
 */
export async function evaluateInboundFastDiscard(params: {
  client: WeChatClient;
  group: GroupConfig;
  groupBuffers: Map<string, Message[]>;
  escalation?: EscalationService;
  memoryHealth?: MemoryHealthMonitor;
  chatId: string;
  chatName: string;
  isGroup: boolean;
  snapshotLocalIds: number[];
}): Promise<FastDiscardResult | undefined> {
  const {
    client,
    group,
    groupBuffers,
    escalation,
    memoryHealth,
    chatId,
    chatName,
    isGroup,
    snapshotLocalIds,
  } = params;

  if (snapshotLocalIds.length === 0) return undefined;

  const all = await client.listMessages(chatId, 40);
  const unseen = snapshotMessages(all, snapshotLocalIds);
  if (unseen.length === 0) return undefined;

  const chatCtx = ensureChatContext(chatId);
  const gate = await evaluateInboundGate({
    chatId,
    chatName,
    isGroup,
    unseen,
    group,
    groupBuffers,
    chatCtx,
    escalation,
    memoryHealth,
    transcriptEntries: loadTranscript(chatCtx.transcriptPath),
    mode: "fast",
  });

  if (gate.action === "discard") {
    return {
      reason: gate.reason,
      localIds: gate.unseen.map((m) => m.localId),
    };
  }

  return undefined;
}

export function logFastDiscard(
  chatName: string,
  reason: FastDiscardReason,
  chatId?: string,
): void {
  console.log(`[pi-wechat] ${chatName}: fast-discard (${reason})`);
  appendAgentTrace({
    chatId,
    chatName,
    phase: "discard",
    detail: reason,
  });
}
