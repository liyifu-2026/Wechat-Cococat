import { decideCustomerEscalation } from "./escalation/decision.js";
import { loadEscalationConfig } from "./escalation/config.js";
import { loadChatEscalationState } from "./escalation/state-store.js";
import type { ExecutedAction } from "./escalation/triage-normalize.js";
import type {
  ChatEscalationState,
  EscalationConfig,
  GateAction,
} from "./escalation/types.js";
import { checkStealthText } from "./stealth-words.js";

export type PreviewReplyResult = {
  /** Console 展示别名（reply / deflect / ignore / escalate_a / probe_b） */
  action: string;
  gate: GateAction;
  executedAction: ExecutedAction;
  reason: string;
  answer: string;
  stealthOk: boolean;
  bannedHits: string[];
  confidence?: number;
  source?: "llm" | "fallback";
};

function resolvePreviewAnswer(
  executed: ExecutedAction,
  _config: EscalationConfig,
  query: string,
): string {
  switch (executed) {
    case "SEND_DEFLECT_LINE":
    case "HANDOFF_ESCALATE":
      return "（客户侧静默，不向客户发送自动消息）";
    case "CODE_TRIGGERED_HANDOFF":
    case "HANDOFF_PROBE":
      return "（不向客户发送消息，会话 mute）";
    case "NO_REPLY":
      return "（静默，不回复）";
    case "CONTINUE_AGENT":
      if (/退款|退货/u.test(query)) {
        return "关于退款，我们一般会在 3-5 个工作日内原路退回。方便提供一下订单号吗？";
      }
      return "关于您的问题，我们这边稍后为您核实。方便补充一下具体情况吗？";
  }
}

/** Console / API preview — uses same Escalation Decision as runtime. */
export async function previewCustomerReply(params: {
  query: string;
  chatId?: string;
  chatState?: ChatEscalationState;
  config?: EscalationConfig;
}): Promise<PreviewReplyResult> {
  const config = params.config ?? loadEscalationConfig();
  const chatState =
    params.chatState ??
    (params.chatId
      ? loadChatEscalationState(params.chatId)
      : { deflectSent: false, probeStreak: 0 });
  const decision = await decideCustomerEscalation({
    combinedText: params.query.trim(),
    chatState,
    config,
  });
  const answer = resolvePreviewAnswer(
    decision.executedAction,
    config,
    params.query,
  );
  const stealth = checkStealthText(answer);

  return {
    action: decision.action,
    gate: decision.gate,
    executedAction: decision.executedAction,
    reason: decision.reason,
    answer,
    stealthOk: stealth.ok,
    bannedHits: stealth.hits,
    confidence: decision.confidence,
    source: decision.source,
  };
}
