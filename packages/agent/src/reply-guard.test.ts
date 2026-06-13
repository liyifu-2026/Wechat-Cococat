import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReplySkip,
  isReplyCoolingDown,
  recordAutoReply,
  shouldSkipSelfTalk,
} from "./reply-guard.js";
import type { TranscriptEntry } from "./transcript.js";

describe("reply-guard", () => {
  it("cooling down blocks unless mentioned", () => {
    const chatId = "test-cooldown-chat";
    recordAutoReply(chatId);
    assert.equal(isReplyCoolingDown(chatId, 30_000), true);
    assert.equal(
      evaluateReplySkip({
        chatId,
        cooldownMs: 30_000,
        transcriptEntries: [],
        wasMentioned: true,
      }),
      undefined,
    );
    assert.equal(
      evaluateReplySkip({
        chatId,
        cooldownMs: 30_000,
        transcriptEntries: [],
        wasMentioned: false,
      }),
      "cooling_down",
    );
  });

  it("self-talk tail skips when not mentioned", () => {
    const entries: TranscriptEntry[] = [
      { role: "assistant", text: "a" },
      { role: "assistant", text: "b" },
      { role: "assistant", text: "c" },
      { role: "assistant", text: "d" },
    ];
    assert.equal(shouldSkipSelfTalk(entries), true);
    assert.equal(
      evaluateReplySkip({
        chatId: "other",
        cooldownMs: 0,
        transcriptEntries: entries,
        wasMentioned: false,
      }),
      "self_talk",
    );
  });
});
