import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractCaptionText } from "./caption-llm.js";

describe("extractCaptionText", () => {
  test("prefers content field", () => {
    assert.equal(
      extractCaptionText({ content: "你好", reasoning_content: "ignore" }),
      "你好",
    );
  });

  test("falls back to quoted text in reasoning", () => {
    assert.equal(
      extractCaptionText({
        content: "",
        reasoning_content:
          '语音转写结果是："hello hello 掉泪了没"\n\nLet me verify.',
      }),
      "hello hello 掉泪了没",
    );
  });

  test("returns undefined when both empty", () => {
    assert.equal(extractCaptionText({ content: "", reasoning_content: "" }), undefined);
  });
});
