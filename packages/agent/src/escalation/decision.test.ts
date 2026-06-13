import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideCustomerEscalation,
  decideCustomerEscalationRules,
} from "./decision.js";
import type { EscalationConfig } from "./types.js";
import { previewCustomerReply, previewCustomerReplyRules } from "../preview-reply.js";

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

describe("escalation decision", () => {
  it("rules and async decision agree when LLM disabled", async () => {
    const text = "我要转人工投诉";
    const chatState = { deflectSent: false, probeStreak: 0 };
    const rules = decideCustomerEscalationRules({
      combinedText: text,
      chatState,
      config: cfg,
    });
    const decision = await decideCustomerEscalation({
      combinedText: text,
      chatState,
      config: cfg,
    });
    assert.equal(decision.action, rules.action);
    assert.equal(decision.source, "rules");
  });

  it("previewCustomerReply matches runtime decision without LLM", async () => {
    const preview = await previewCustomerReply({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    const rules = previewCustomerReplyRules({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(preview.action, rules.action);
    assert.equal(preview.source, "rules");
    assert.equal(preview.stealthOk, true);
  });
});
