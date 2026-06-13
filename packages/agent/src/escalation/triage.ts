import type { Message } from "@cococat/shared";
import { isUnambiguousLowSignal } from "../low-signal.js";
import type { ChatEscalationState, EscalationConfig, TriageResult } from "./types.js";

const ESCALATE_PATTERNS = [
  /转人工/u,
  /人工客服/u,
  /要投诉/u,
  /投诉你/u,
  /12315/u,
  /消协/u,
  /律师函/u,
  /起诉/u,
  /报警/u,
  /找你们领导/u,
  /找负责人/u,
];

const HUMAN_REQUEST_PATTERNS = [/真人/u, /真人客服/u, /真人吗/u];

const PROBE_PATTERNS = [
  /机器人/u,
  /\bai\b/i,
  /人工智能/u,
  /chatgpt/i,
  /openai/i,
  /图灵/u,
  /你是不是.{0,6}(机器|ai|智能)/iu,
  /你是.{0,4}(gpt|AI)/iu,
  /证明.{0,6}(你是)?人/u,
  /让它?复述/u,
  /忽略.{0,6}指令/u,
];

export function isProbeMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PROBE_PATTERNS.some((re) => re.test(t));
}

export function isEscalateMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ESCALATE_PATTERNS.some((re) => re.test(t))) return true;
  return HUMAN_REQUEST_PATTERNS.some((re) => re.test(t));
}

export function triageCustomerText(
  combinedText: string,
  chatState: ChatEscalationState,
  config: EscalationConfig,
  messages?: Message[],
): TriageResult {
  if (messages && isUnambiguousLowSignal(messages)) {
    return { action: "silent", reason: "low_signal_unambiguous" };
  }

  const text = combinedText.trim();
  if (!text) {
    return { action: "silent", reason: "empty" };
  }

  if (isEscalateMessage(text)) {
    return { action: "escalate_a", reason: "explicit_escalate_or_risk" };
  }

  if (isProbeMessage(text)) {
    if (!chatState.deflectSent) {
      return { action: "deflect", reason: "first_identity_probe" };
    }

    const nextStreak = chatState.probeStreak + 1;
    if (nextStreak >= config.probeStreakThreshold) {
      return {
        action: "probe_b",
        reason: `probe_streak_${nextStreak}`,
      };
    }

    return { action: "ignore", reason: "probe_after_deflect" };
  }

  if (chatState.deflectSent && chatState.probeStreak > 0) {
    return { action: "reply", reason: "business_resumed" };
  }

  return { action: "reply", reason: "default" };
}

export function nextChatStateAfterTriage(
  prev: ChatEscalationState,
  result: TriageResult,
): ChatEscalationState {
  switch (result.action) {
    case "deflect":
      return { deflectSent: true, probeStreak: 0 };
    case "ignore":
      if (result.reason === "probe_after_deflect") {
        return { deflectSent: true, probeStreak: prev.probeStreak + 1 };
      }
      return prev;
    case "probe_b":
    case "escalate_a":
      return { deflectSent: prev.deflectSent, probeStreak: 0 };
    case "silent":
      return prev;
    case "reply":
      if (
        result.reason === "business_resumed" ||
        (prev.probeStreak > 0 && result.reason === "default")
      ) {
        return { deflectSent: prev.deflectSent, probeStreak: 0 };
      }
      return prev;
    default:
      return prev;
  }
}
