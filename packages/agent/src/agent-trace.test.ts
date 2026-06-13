import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { appendAgentTrace } from "./agent-trace.js";

describe("agent-trace", () => {
  test("appendAgentTrace accepts thinking phase", () => {
    assert.doesNotThrow(() =>
      appendAgentTrace({
        chatId: "wxid_test",
        chatName: "测试",
        phase: "thinking",
        detail: "先查 wiki 再回复",
      }),
    );
  });

  test("appendAgentTrace ignores blank detail", () => {
    assert.doesNotThrow(() =>
      appendAgentTrace({
        phase: "skip",
        detail: "   ",
      }),
    );
  });
});
