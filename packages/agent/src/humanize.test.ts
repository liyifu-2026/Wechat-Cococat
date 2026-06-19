import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { humanizeReplyText } from "./humanize.js";

describe("humanizeReplyText", () => {
  test("drops assistant-style opening and closing wrappers", () => {
    assert.equal(
      humanizeReplyText(
        "当然可以，我来帮你整理一下：\n今天先别急着改，先看日志。\n如果还有需要可以随时告诉我。",
      ),
      "今天先别急着改，先看日志。",
    );
  });

  test("removes standalone generated-content labels", () => {
    assert.equal(
      humanizeReplyText("下面是我的建议：\n1. 先等等\n2. 晚点再看"),
      "先等等\n晚点再看",
    );
  });
});
