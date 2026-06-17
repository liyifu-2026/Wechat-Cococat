import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatAgentHandoffAlert,
  formatEscalationAlert,
  formatLowConfidenceFyi,
} from "./maintainer-notify.js";
import { assertAllLinesWithinMax } from "./wechat-line-wrap.test.js";

describe("maintainer-notify", () => {
  test("escalation alert has clear context and short lines", () => {
    const text = formatEscalationAlert({
      chatName: "张三",
      chatId: "wxid_abc123456789",
      trigger: "escalate_a",
      reason: "用户威胁投诉@llm",
      userLines: ["在吗", "我要投诉你们"],
      muteHours: 24,
    });
    assertAllLinesWithinMax(text);
    assert.match(text, /【需处理】/);
    assert.match(text, /客户:张三/);
    assert.match(text, /刚说:我要投诉你们/);
    assert.match(text, /类型:转人工/);
    assert.match(text, /详情:用户威胁投诉/);
    assert.doesNotMatch(text, /@llm/);
    assert.match(text, /客户侧静默/);
    assert.doesNotMatch(text, /已发转接语/);
  });

  test("agent handoff alert", () => {
    const text = formatAgentHandoffAlert({
      chatName: "李四",
      chatId: "wxid_xyz",
      reason: "technical",
      summary: "502错误查wiki仍无解需工程介入",
      userLines: ["接口一直502"],
      muteHours: 24,
    });
    assertAllLinesWithinMax(text);
    assert.match(text, /【Agent升级】/);
    assert.match(text, /刚说:接口一直502/);
    assert.match(text, /摘要:/);
    assert.match(text, /客户侧静默/);
  });

  test("low confidence fyi", () => {
    const text = formatLowConfidenceFyi({
      chatName: "王五",
      chatId: "wxid_1",
      confidence: 0.42,
      threshold: 0.55,
      userLines: ["这个怎么退款"],
    });
    assertAllLinesWithinMax(text);
    assert.match(text, /【低置信】/);
    assert.match(text, /刚说:这个怎么退款/);
  });
});
