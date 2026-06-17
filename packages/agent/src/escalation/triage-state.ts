import type { ChatEscalationState } from "./types.js";
import type { ExecutedAction } from "./triage-normalize.js";

/** 按 ExecutedAction 更新试探期状态；continue 双清。 */
export function nextChatStateAfterExecuted(
  prev: ChatEscalationState,
  executed: ExecutedAction,
): ChatEscalationState {
  switch (executed) {
    case "CONTINUE_AGENT":
      return { deflectSent: false, probeStreak: 0 };
    case "SEND_DEFLECT_LINE":
      return { deflectSent: true, probeStreak: 0 };
    case "NO_REPLY":
      if (prev.deflectSent) {
        return { deflectSent: true, probeStreak: prev.probeStreak + 1 };
      }
      return prev;
    case "CODE_TRIGGERED_HANDOFF":
    case "HANDOFF_ESCALATE":
    case "HANDOFF_PROBE":
      return { deflectSent: prev.deflectSent, probeStreak: 0 };
  }
}
