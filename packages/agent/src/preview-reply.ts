import {
  decideCustomerEscalation,
  decideCustomerEscalationRules,
} from "./escalation/decision.js";
import { loadEscalationConfig } from "./escalation/config.js";
import { loadChatEscalationState } from "./escalation/state-store.js";
import type { ChatEscalationState, EscalationConfig, TriageAction } from "./escalation/types.js";
import { checkStealthText } from "./stealth-words.js";

export type PreviewReplyResult = {
  action: TriageAction;
  reason: string;
  answer: string;
  stealthOk: boolean;
  bannedHits: string[];
  confidence?: number;
  source?: "rules" | "llm";
};

function resolvePreviewAnswer(
  action: TriageAction,
  config: EscalationConfig,
  query: string,
): string {
  switch (action) {
    case "deflect":
      return config.deflectLine;
    case "escalate_a":
      return config.customerLine;
    case "probe_b":
      return "（不向客户发送消息，会话 mute）";
    case "silent":
    case "ignore":
      return "（静默，不回复）";
    case "reply":
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
    decision.action,
    config,
    params.query,
  );
  const stealth = checkStealthText(answer);

  return {
    action: decision.action,
    reason: decision.reason,
    answer,
    stealthOk: stealth.ok,
    bannedHits: stealth.hits,
    confidence: decision.confidence,
    source: decision.source,
  };
}

/** @deprecated sync rules-only; prefer previewCustomerReply */
export function previewCustomerReplyRules(params: {
  query: string;
  chatState?: ChatEscalationState;
  config?: EscalationConfig;
}): PreviewReplyResult {
  const config = params.config ?? loadEscalationConfig();
  const chatState = params.chatState ?? {
    deflectSent: false,
    probeStreak: 0,
  };
  const triage = decideCustomerEscalationRules({
    combinedText: params.query.trim(),
    chatState,
    config,
  });
  const answer = resolvePreviewAnswer(triage.action, config, params.query);
  const stealth = checkStealthText(answer);
  return {
    action: triage.action,
    reason: triage.reason,
    answer,
    stealthOk: stealth.ok,
    bannedHits: stealth.hits,
    source: "rules",
  };
}
