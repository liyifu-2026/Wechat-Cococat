import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asRedis, FakeRedis } from "./fake-redis.js";
import {
  addPendingLocalIds,
  drainPendingLocalIds,
} from "./pending.js";
import {
  addThoughtfulPendingLocalIds,
  drainThoughtfulPendingLocalIds,
  listThoughtfulPendingLocalIds,
} from "./thoughtful-pending.js";
import { shouldOffloadThoughtfulToOutbound } from "../thoughtful.js";

describe("queue smoke (inbound coalesce)", () => {
  it("accumulates localIds in pending SET and drains sorted", async () => {
    const redis = asRedis(new FakeRedis());
    const chatId = "room@chatroom";

    await addPendingLocalIds(redis, chatId, [12, 5]);
    await addPendingLocalIds(redis, chatId, [12, 8]);

    const snapshot = await drainPendingLocalIds(redis, chatId);
    assert.deepEqual(snapshot, [5, 8, 12]);

    const again = await drainPendingLocalIds(redis, chatId);
    assert.deepEqual(again, []);
  });

  it("thoughtful pending merges before outbound drain", async () => {
    const redis = asRedis(new FakeRedis());
    const chatId = "wxid_user";

    await addThoughtfulPendingLocalIds(redis, chatId, [3]);
    await addThoughtfulPendingLocalIds(redis, chatId, [7, 3]);

    assert.deepEqual(
      await listThoughtfulPendingLocalIds(redis, chatId),
      [3, 7],
    );

    const drained = await drainThoughtfulPendingLocalIds(redis, chatId);
    assert.deepEqual(drained, [3, 7]);
    assert.deepEqual(
      await listThoughtfulPendingLocalIds(redis, chatId),
      [],
    );
  });

  it("offloads thoughtful only when queue enabled", () => {
    assert.equal(
      shouldOffloadThoughtfulToOutbound(
        true,
        { groupMode: "bot", replyDelayMs: null, burstDelayMs: null },
        ["帮我对比一下方案"],
      ),
      true,
    );
    assert.equal(
      shouldOffloadThoughtfulToOutbound(
        false,
        { groupMode: "bot", replyDelayMs: null, burstDelayMs: null },
        ["帮我对比一下方案"],
      ),
      false,
    );
  });
});
