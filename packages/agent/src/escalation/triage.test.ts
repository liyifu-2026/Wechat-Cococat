import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isEscalateMessage,
  isProbeMessage,
  nextChatStateAfterTriage,
  triageCustomerText,
} from "./triage.js";
import type { ChatEscalationState, EscalationConfig } from "./types.js";

const cfg: EscalationConfig = {
  enabled: true,
  maintainerChatId: "wxid_maintainer",
  maintainerDisplayName: "维护者",
  notifyEscalate: true,
  notifyProbeLoop: true,
  notifyLowConfidence: false,
  deflectLine: "deflect",
  customerLine: "customer",
  muteHoursEscalate: 24,
  muteHoursProbeLoop: 2,
  probeStreakThreshold: 2,
  triageUseLlm: false,
  lowConfidenceThreshold: 0.45,
};

const fresh: ChatEscalationState = { deflectSent: false, probeStreak: 0 };

describe("triage rules", () => {
  test("detects probe and escalate patterns", () => {
    assert.equal(isProbeMessage("你是机器人吗"), true);
    assert.equal(isEscalateMessage("我要转人工"), true);
    assert.equal(isProbeMessage("发货了吗"), false);
  });

  test("first probe deflects", () => {
    const r = triageCustomerText("你是 AI 吧", fresh, cfg);
    assert.equal(r.action, "deflect");
  });

  test("second consecutive probe ignores", () => {
    const state = { deflectSent: true, probeStreak: 0 };
    const r = triageCustomerText("证明你是人", state, cfg);
    assert.equal(r.action, "ignore");
    const next = nextChatStateAfterTriage(state, r);
    assert.equal(next.probeStreak, 1);
  });

  test("third probe triggers probe_b", () => {
    const state = { deflectSent: true, probeStreak: 1 };
    const r = triageCustomerText("你就是 chatgpt", state, cfg);
    assert.equal(r.action, "probe_b");
  });

  test("business message after deflect replies", () => {
    const state = { deflectSent: true, probeStreak: 1 };
    const r = triageCustomerText("想问下退款流程", state, cfg);
    assert.equal(r.action, "reply");
    assert.equal(r.reason, "business_resumed");
  });

  test("explicit escalate", () => {
    const r = triageCustomerText("我要投诉12315", fresh, cfg);
    assert.equal(r.action, "escalate_a");
  });

  test("empty message is silent", () => {
    const r = triageCustomerText("", fresh, cfg);
    assert.equal(r.action, "silent");
  });
});
