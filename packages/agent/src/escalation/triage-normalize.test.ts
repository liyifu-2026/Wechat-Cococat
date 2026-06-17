import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  executedActionToDisplayAction,
  normalizeGateOutcome,
} from "./triage-normalize.js";
import { nextChatStateAfterExecuted } from "./triage-state.js";
import type { ChatEscalationState, EscalationConfig } from "./types.js";

const cfg: EscalationConfig = {
  enabled: true,
  maintainerChatId: "wxid_m",
  maintainerDisplayName: "维护者",
  maintainers: [{ chatId: "wxid_m", displayName: "维护者" }],
  notifyEscalate: true,
  notifyProbeLoop: true,
  notifyLowConfidence: false,
  triageUseLlm: true,
  lowConfidenceThreshold: 0.45,
  deflectLine: "deflect",
  customerLine: "customer",
  muteHoursEscalate: 24,
  muteHoursProbeLoop: 2,
  probeStreakThreshold: 2,
  agentHandoffEnabled: true,
};

const fresh: ChatEscalationState = { deflectSent: false, probeStreak: 0 };

function raw(
  gate: import("./types.js").GateAction,
  reason = "test",
  source: "llm" | "fallback" = "llm",
) {
  return { gate, reason, confidence: 0.9, source };
}

describe("normalizeGateOutcome", () => {
  test("continue → CONTINUE_AGENT", () => {
    const n = normalizeGateOutcome(raw("continue"), fresh, cfg);
    assert.equal(n.gate, "continue");
    assert.equal(n.executedAction, "CONTINUE_AGENT");
  });

  test("empty skip → NO_REPLY without deflect", () => {
    const n = normalizeGateOutcome(
      raw("skip", "empty", "fallback"),
      fresh,
      cfg,
    );
    assert.equal(n.executedAction, "NO_REPLY");
    assert.equal(executedActionToDisplayAction(n.executedAction), "ignore");
  });

  test("first probe skip → SEND_DEFLECT_LINE", () => {
    const n = normalizeGateOutcome(raw("skip"), fresh, cfg);
    assert.equal(n.executedAction, "SEND_DEFLECT_LINE");
    assert.equal(executedActionToDisplayAction(n.executedAction), "deflect");
  });

  test("skip after deflect → NO_REPLY", () => {
    const state = { deflectSent: true, probeStreak: 0 };
    const n = normalizeGateOutcome(raw("skip"), state, cfg);
    assert.equal(n.executedAction, "NO_REPLY");
  });

  test("skip streak at threshold → CODE_TRIGGERED_HANDOFF", () => {
    const state = { deflectSent: true, probeStreak: 1 };
    const n = normalizeGateOutcome(raw("skip"), state, cfg);
    assert.equal(n.executedAction, "CODE_TRIGGERED_HANDOFF");
    assert.equal(executedActionToDisplayAction(n.executedAction), "probe_b");
  });

  test("handoff → HANDOFF_ESCALATE", () => {
    const n = normalizeGateOutcome(raw("handoff", "投诉"), fresh, cfg);
    assert.equal(n.executedAction, "HANDOFF_ESCALATE");
    assert.equal(executedActionToDisplayAction(n.executedAction), "escalate_a");
  });

  test("reason preserved for audit", () => {
    const n = normalizeGateOutcome(raw("handoff", "用户威胁12315"), fresh, cfg);
    assert.equal(n.reason, "用户威胁12315");
  });
});

describe("normalize + nextChatStateAfterExecuted integration", () => {
  test("continue dual-clears deflectSent and probeStreak", () => {
    const prev = { deflectSent: true, probeStreak: 2 };
    const n = normalizeGateOutcome(raw("continue"), prev, cfg);
    const next = nextChatStateAfterExecuted(prev, n.executedAction);
    assert.deepEqual(next, { deflectSent: false, probeStreak: 0 });
  });

  test("deflect sets deflectSent", () => {
    const n = normalizeGateOutcome(raw("skip"), fresh, cfg);
    assert.equal(n.executedAction, "SEND_DEFLECT_LINE");
    const next = nextChatStateAfterExecuted(fresh, n.executedAction);
    assert.deepEqual(next, { deflectSent: true, probeStreak: 0 });
  });

  test("no_reply increments streak after deflect", () => {
    const prev = { deflectSent: true, probeStreak: 0 };
    const n = normalizeGateOutcome(raw("skip"), prev, cfg);
    assert.equal(n.executedAction, "NO_REPLY");
    const next = nextChatStateAfterExecuted(prev, n.executedAction);
    assert.equal(next.probeStreak, 1);
  });
});
