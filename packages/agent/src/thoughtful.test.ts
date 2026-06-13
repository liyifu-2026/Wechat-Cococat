import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReflectGap,
  shouldOffloadThoughtfulToOutbound,
  shouldRunThoughtfulReflect,
  shouldUseThoughtful,
} from "./thoughtful.js";
import {
  pickThoughtfulAckPhrase,
  shouldUseDelayedThoughtfulAck,
} from "./thoughtful-ack.js";

describe("thoughtful", () => {
  it("honours explicit replyMode", () => {
    assert.equal(
      shouldUseThoughtful({ replyMode: "thoughtful" } as never, ["在吗"]),
      true,
    );
    assert.equal(
      shouldUseThoughtful({ replyMode: "fast" } as never, ["请分析一下"]),
      false,
    );
  });

  it("heuristic upgrades complex questions", () => {
    assert.equal(
      shouldUseThoughtful(
        { groupMode: "bot", replyDelayMs: null, burstDelayMs: null },
        ["帮我对比一下这两个方案"],
      ),
      true,
    );
  });

  it("offloads inbound thoughtful when queue enabled", () => {
    assert.equal(
      shouldOffloadThoughtfulToOutbound(
        true,
        { groupMode: "bot", replyDelayMs: null, burstDelayMs: null },
        ["帮我对比一下这两个方案"],
      ),
      true,
    );
    assert.equal(
      shouldOffloadThoughtfulToOutbound(
        false,
        { replyMode: "thoughtful" } as never,
        ["在吗"],
      ),
      false,
    );
  });

  it("parses reflect GAP responses", () => {
    assert.equal(parseReflectGap("OK"), undefined);
    assert.equal(parseReflectGap("GAP:缺少报价"), "缺少报价");
    assert.equal(parseReflectGap("gap:需要确认时间"), "需要确认时间");
  });

  it("service mode enables delayed ack by default", () => {
    assert.equal(
      shouldUseDelayedThoughtfulAck({
        groupMode: "bot",
        replyDelayMs: null,
        burstDelayMs: null,
        personaMode: "service",
      }),
      true,
    );
    assert.equal(
      shouldUseDelayedThoughtfulAck({
        groupMode: "bot",
        replyDelayMs: null,
        burstDelayMs: null,
        personaMode: "friend",
        thoughtfulAck: false,
      }),
      false,
    );
  });

  it("rotates ack phrases avoiding recent", () => {
    const style = {
      groupMode: "bot" as const,
      replyDelayMs: null,
      burstDelayMs: null,
      personaMode: "service" as const,
      thoughtfulAckPhrases: ["A", "B", "C"],
    };
    const chatId = "ack-rotate@test";
    const first = pickThoughtfulAckPhrase(chatId, style);
    assert.ok(first);
  });

  it("reflect enabled via style or env", () => {
    assert.equal(
      shouldRunThoughtfulReflect({
        groupMode: "bot",
        replyDelayMs: null,
        burstDelayMs: null,
        thoughtfulReflect: true,
      }),
      true,
    );
    const prev = process.env.WECHAT_THOUGHTFUL_REFLECT;
    process.env.WECHAT_THOUGHTFUL_REFLECT = "true";
    assert.equal(
      shouldRunThoughtfulReflect({
        groupMode: "bot",
        replyDelayMs: null,
        burstDelayMs: null,
      }),
      true,
    );
    if (prev === undefined) delete process.env.WECHAT_THOUGHTFUL_REFLECT;
    else process.env.WECHAT_THOUGHTFUL_REFLECT = prev;
  });
});
