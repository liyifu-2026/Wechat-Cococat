import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nextChatStateAfterExecuted } from "./triage-state.js";
import type { ChatEscalationState } from "./types.js";

const fresh: ChatEscalationState = { deflectSent: false, probeStreak: 0 };

describe("triage state", () => {
  test("SEND_DEFLECT_LINE marks deflectSent", () => {
    const next = nextChatStateAfterExecuted(fresh, "SEND_DEFLECT_LINE");
    assert.equal(next.deflectSent, true);
    assert.equal(next.probeStreak, 0);
  });

  test("NO_REPLY after deflect increments probeStreak", () => {
    const state = { deflectSent: true, probeStreak: 0 };
    const next = nextChatStateAfterExecuted(state, "NO_REPLY");
    assert.equal(next.probeStreak, 1);
  });

  test("CONTINUE_AGENT dual-clears deflectSent and probeStreak", () => {
    const state = { deflectSent: true, probeStreak: 2 };
    const next = nextChatStateAfterExecuted(state, "CONTINUE_AGENT");
    assert.equal(next.deflectSent, false);
    assert.equal(next.probeStreak, 0);
  });

  test("HANDOFF_ESCALATE resets probe streak", () => {
    const state = { deflectSent: true, probeStreak: 2 };
    const next = nextChatStateAfterExecuted(state, "HANDOFF_ESCALATE");
    assert.equal(next.probeStreak, 0);
    assert.equal(next.deflectSent, true);
  });

  test("NO_REPLY without deflect leaves state unchanged", () => {
    const next = nextChatStateAfterExecuted(fresh, "NO_REPLY");
    assert.deepEqual(next, fresh);
  });

  test("CODE_TRIGGERED_HANDOFF resets probe streak", () => {
    const state = { deflectSent: true, probeStreak: 2 };
    const next = nextChatStateAfterExecuted(state, "CODE_TRIGGERED_HANDOFF");
    assert.equal(next.probeStreak, 0);
  });
});
