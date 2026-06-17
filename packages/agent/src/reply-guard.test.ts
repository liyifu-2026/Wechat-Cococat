import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReplySkip,
  isReplyCoolingDown,
  recordAutoReply,
} from "./reply-guard.js";

describe("reply-guard", () => {
  it("cooling down blocks unless mentioned", () => {
    const chatId = "test-cooldown-chat";
    recordAutoReply(chatId);
    assert.equal(isReplyCoolingDown(chatId, 30_000), true);
    assert.equal(
      evaluateReplySkip({
        chatId,
        cooldownMs: 30_000,
        wasMentioned: true,
      }),
      undefined,
    );
    assert.equal(
      evaluateReplySkip({
        chatId,
        cooldownMs: 30_000,
        wasMentioned: false,
      }),
      "cooling_down",
    );
  });
});
