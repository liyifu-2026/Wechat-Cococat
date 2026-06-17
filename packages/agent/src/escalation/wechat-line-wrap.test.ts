import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  WECHAT_LINE_MAX_CHARS,
  formatWechatText,
  splitWechatLine,
  wechatLineCount,
} from "./wechat-line-wrap.js";

function assertAllLinesWithinMax(text: string, max = WECHAT_LINE_MAX_CHARS): void {
  for (const line of text.split("\n")) {
    assert.ok(
      wechatLineCount(line) <= max,
      `行过长(${wechatLineCount(line)}>${max}): ${line}`,
    );
  }
}

describe("splitWechatLine", () => {
  test("splits long CJK text", () => {
    assert.deepEqual(splitWechatLine("一二三四五六七八九十十一"), [
      "一二三四五六七八九十十",
      "一",
    ]);
  });

  test("empty returns empty", () => {
    assert.deepEqual(splitWechatLine("   "), []);
  });
});

describe("formatWechatText", () => {
  test("wraps each logical line", () => {
    const out = formatWechatText([
      "【需处理】",
      "刚说:我要投诉你们客服没人理",
    ]);
    assertAllLinesWithinMax(out);
    assert.match(out, /我要投诉你们/);
  });
});

export { assertAllLinesWithinMax };
