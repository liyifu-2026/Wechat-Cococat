import { loadChatEscalationState } from "./state-store.js";
import {
  triageCustomerHybrid,
  type HybridTriageOutcome,
} from "./triage-hybrid.js";
import { triageCustomerText } from "./triage.js";
import type {
  ChatEscalationState,
  EscalationConfig,
  TriageResult,
} from "./types.js";
import type { Message } from "@cococat/shared";
import type { TranscriptEntry } from "../transcript.js";

export type EscalationDecision = HybridTriageOutcome;

export type EscalationDecisionParams = {
  combinedText: string;
  chatState: ChatEscalationState;
  config: EscalationConfig;
  messages?: Message[];
  transcriptEntries?: TranscriptEntry[];
};

/** Runtime + Console preview: rules with optional LLM pass (unified gate). */
export async function decideCustomerEscalation(
  params: EscalationDecisionParams,
): Promise<EscalationDecision> {
  return triageCustomerHybrid(params);
}

/** Rules-only decision (tests / fast paths). */
export function decideCustomerEscalationRules(
  params: Omit<EscalationDecisionParams, "messages" | "transcriptEntries"> & {
    messages?: Message[];
  },
): TriageResult {
  return triageCustomerText(
    params.combinedText,
    params.chatState,
    params.config,
    params.messages,
  );
}

export function loadEscalationChatState(chatId: string): ChatEscalationState {
  return loadChatEscalationState(chatId);
}

/** escalation 未启用时，将需维护者通道的动作降级为 reply。 */
export function downgradeWhenEscalationDisabled(
  action: TriageResult["action"],
): TriageResult["action"] {
  if (
    action === "deflect" ||
    action === "escalate_a" ||
    action === "probe_b"
  ) {
    return "reply";
  }
  return action;
}
