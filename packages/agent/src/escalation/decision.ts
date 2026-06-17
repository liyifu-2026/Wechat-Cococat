import { loadChatEscalationState } from "./state-store.js";
import {
  triageCustomerGate,
  type GateTriageOutcome,
} from "./triage-hybrid.js";
import type { ChatEscalationState, EscalationConfig } from "./types.js";
import type { Message } from "@cococat/shared";
import type { TranscriptEntry } from "../transcript.js";

export type EscalationDecision = GateTriageOutcome;

export type EscalationDecisionParams = {
  combinedText: string;
  chatState: ChatEscalationState;
  config: EscalationConfig;
  messages?: Message[];
  transcriptEntries?: TranscriptEntry[];
};

/** Runtime + Console preview: 3 档 Gate + ExecutedAction。 */
export async function decideCustomerEscalation(
  params: EscalationDecisionParams,
): Promise<EscalationDecision> {
  return triageCustomerGate(params);
}

export function loadEscalationChatState(chatId: string): ChatEscalationState {
  return loadChatEscalationState(chatId);
}
