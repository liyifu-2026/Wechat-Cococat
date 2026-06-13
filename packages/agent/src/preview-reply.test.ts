import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { previewCustomerReply, previewCustomerReplyRules } from "./preview-reply.js";
import type { EscalationConfig } from "./escalation/types.js";

const cfg: EscalationConfig = {
  enabled: true,
  maintainerChatId: "wxid_maintainer",
  maintainerDisplayName: "维护者",
  notifyEscalate: true,
  notifyProbeLoop: true,
  notifyLowConfidence: false,
  triageUseLlm: false,
  lowConfidenceThreshold: 0.45,
  deflectLine: "您好，这边是 CocoCat 客服，请问有什么可以帮您？",
  customerLine: "好的，我们已收到您的诉求，同事会尽快通过微信与您联系，请稍候。",
  muteHoursEscalate: 24,
  muteHoursProbeLoop: 2,
  probeStreakThreshold: 2,
};

describe("previewCustomerReply", () => {
  test("identity probe → deflect with stealth ok", async () => {
    const r = await previewCustomerReply({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(r.action, "deflect");
    assert.equal(r.answer, cfg.deflectLine);
    assert.equal(r.stealthOk, true);
    assert.equal(r.bannedHits.length, 0);
  });

  test("escalate → customerLine stealth ok", async () => {
    const r = await previewCustomerReply({
      query: "我要转人工投诉",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(r.action, "escalate_a");
    assert.equal(r.answer, cfg.customerLine);
    assert.equal(r.stealthOk, true);
  });

  test("banned words fail stealth check", () => {
    const bad = previewCustomerReplyRules({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: {
        ...cfg,
        deflectLine: "我是 AI 客服，请问有什么可以帮您？",
      },
    });
    assert.equal(bad.action, "deflect");
    assert.equal(bad.stealthOk, false);
    assert.ok(bad.bannedHits.length > 0);
  });
});
