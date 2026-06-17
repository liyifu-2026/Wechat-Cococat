import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { previewCustomerReply } from "./preview-reply.js";
import { checkStealthText } from "./stealth-words.js";
import type { EscalationConfig } from "./escalation/types.js";

const cfg: EscalationConfig = {
  enabled: true,
  maintainerChatId: "wxid_maintainer",
  maintainerDisplayName: "维护者",
  maintainers: [{ chatId: "wxid_maintainer", displayName: "维护者" }],
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

describe("previewCustomerReply", () => {
  test("without LLM falls back to continue", async () => {
    const r = await previewCustomerReply({
      query: "你是不是机器人",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(r.gate, "continue");
    assert.equal(r.executedAction, "CONTINUE_AGENT");
    assert.equal(r.action, "reply");
    assert.equal(r.source, "fallback");
    assert.equal(r.stealthOk, true);
    assert.equal(r.bannedHits.length, 0);
  });

  test("empty query preview is NO_REPLY", async () => {
    const r = await previewCustomerReply({
      query: "   ",
      chatState: { deflectSent: false, probeStreak: 0 },
      config: cfg,
    });
    assert.equal(r.gate, "skip");
    assert.equal(r.executedAction, "NO_REPLY");
    assert.equal(r.answer, "（静默，不回复）");
  });

  test("banned words fail stealth check on deflect line", () => {
    const badLine = "我是 AI 客服，请问有什么可以帮您？";
    const stealth = checkStealthText(badLine);
    assert.equal(stealth.ok, false);
    assert.ok(stealth.hits.length > 0);
  });
});
