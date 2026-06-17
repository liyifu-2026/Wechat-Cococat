import type {
  ChatEscalationState,
  EscalationConfig,
  GateAction,
} from "./types.js";

/** 衍生执行语义：service switch / 日志 / Console / 埋点 */
export type ExecutedAction =
  | "CONTINUE_AGENT"
  | "SEND_DEFLECT_LINE"
  | "NO_REPLY"
  | "CODE_TRIGGERED_HANDOFF"
  | "HANDOFF_ESCALATE"
  | "HANDOFF_PROBE";

export type RawGateOutcome = {
  gate: GateAction;
  reason: string;
  confidence: number;
  source: "llm" | "fallback";
};

export type NormalizedGateOutcome = RawGateOutcome & {
  executedAction: ExecutedAction;
};

function resolveSkipExecuted(
  prev: ChatEscalationState,
  config: EscalationConfig,
  raw: RawGateOutcome,
): ExecutedAction {
  if (raw.reason === "empty") {
    return "NO_REPLY";
  }

  if (!prev.deflectSent) {
    return "SEND_DEFLECT_LINE";
  }

  const nextStreak = prev.probeStreak + 1;
  if (nextStreak >= config.probeStreakThreshold) {
    return "CODE_TRIGGERED_HANDOFF";
  }

  return "NO_REPLY";
}

/** LLM / fallback 的 3 档 Gate + 状态机 → ExecutedAction（无 legacy 反向映射） */
export function normalizeGateOutcome(
  raw: RawGateOutcome,
  prevState: ChatEscalationState,
  config: EscalationConfig,
): NormalizedGateOutcome {
  let executedAction: ExecutedAction;

  switch (raw.gate) {
    case "continue":
      executedAction = "CONTINUE_AGENT";
      break;
    case "skip":
      executedAction = resolveSkipExecuted(prevState, config, raw);
      break;
    case "handoff":
      executedAction = "HANDOFF_ESCALATE";
      break;
  }

  return { ...raw, executedAction };
}

/** Console / 旧 API 展示别名（非控制流） */
export function executedActionToDisplayAction(executed: ExecutedAction): string {
  switch (executed) {
    case "CONTINUE_AGENT":
      return "reply";
    case "SEND_DEFLECT_LINE":
      return "deflect";
    case "NO_REPLY":
      return "ignore";
    case "HANDOFF_ESCALATE":
      return "escalate_a";
    case "HANDOFF_PROBE":
    case "CODE_TRIGGERED_HANDOFF":
      return "probe_b";
  }
}

export function downgradeExecutedWhenEscalationDisabled(
  executed: ExecutedAction,
): ExecutedAction {
  switch (executed) {
    case "SEND_DEFLECT_LINE":
    case "HANDOFF_ESCALATE":
    case "HANDOFF_PROBE":
    case "CODE_TRIGGERED_HANDOFF":
      return "CONTINUE_AGENT";
    default:
      return executed;
  }
}
