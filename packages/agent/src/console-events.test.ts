import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { appendConsoleEvent, eventsFilePath } from "./console-events.js";

describe("console-events", () => {
  test("appendConsoleEvent does not throw", () => {
    assert.doesNotThrow(() =>
      appendConsoleEvent({
        kind: "low_confidence",
        chatId: "wxid_test",
        chatName: "测试",
        confidence: 0.2,
      }),
    );
    assert.match(eventsFilePath(), /events\.jsonl$/);
  });
});
