import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideCustomerEscalation } from "./decision.js";
import type { EscalationConfig } from "./types.js";
import { previewCustomerReply } from "../preview-reply.js";

const cfg: EscalationConfig = {
  enabled: true,
  maintainerChatId: "wxid_maintainer",
  maintainerDisplayName: "维护者",
  maintainers: [
    { chatId: "wxid_maintainer", displayName: "维护者" },
  ],
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
  agentHandoffEnabled: true,
};

describe("escalation decision", () => {
  it("falls back to continue when LLM disabled", async () => {
    const decision = await decideCustomerEscalation({
      combinedText: "我要转人工投诉",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(decision.gate, "continue");
    assert.equal(decision.executedAction, "CONTINUE_AGENT");
    assert.equal(decision.action, "reply");
    assert.equal(decision.source, "fallback");
    assert.equal(decision.reason, "llm_disabled");
  });

  it("empty message is skip NO_REPLY without LLM", async () => {
    const decision = await decideCustomerEscalation({
      combinedText: "",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(decision.gate, "skip");
    assert.equal(decision.executedAction, "NO_REPLY");
    assert.equal(decision.source, "fallback");
  });

  it("previewCustomerReply uses same gate path", async () => {
    const preview = await previewCustomerReply({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(preview.gate, "continue");
    assert.equal(preview.executedAction, "CONTINUE_AGENT");
    assert.equal(preview.action, "reply");
    assert.equal(preview.source, "fallback");
    assert.equal(preview.stealthOk, true);
  });
});
