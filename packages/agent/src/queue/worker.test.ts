import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message, WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "../config.js";
import type { GroupConfig } from "../group-config.js";
import type { SessionManager } from "../session.js";
import { asRedis, FakeRedis } from "./fake-redis.js";
import { addPendingLocalIds, drainPendingLocalIds } from "./pending.js";
import { isDuplicateJobError } from "./enqueue.js";
import { handleInboundJob } from "./worker.js";

const defaultGroup: GroupConfig = {
  defaultPolicy: { requireMention: true, replyWithMention: "none" },
  groupOverrides: new Map(),
  groupsConfigPath: "",
  groupHistoryLimit: 50,
};

let dataRoot = "";
const previousQueueEnabled = process.env.QUEUE_ENABLED;

afterEach(() => {
  if (dataRoot) {
    rmSync(dataRoot, { recursive: true, force: true });
    dataRoot = "";
  }
  delete process.env.COCOCAT_DATA_DIR;
  if (previousQueueEnabled === undefined) {
    delete process.env.QUEUE_ENABLED;
  } else {
    process.env.QUEUE_ENABLED = previousQueueEnabled;
  }
});

function setupDataRoot(): void {
  dataRoot = mkdtempSync(join(tmpdir(), "inbound-worker-"));
  process.env.COCOCAT_DATA_DIR = dataRoot;
  process.env.QUEUE_ENABLED = "false";
}

describe("handleInboundJob", () => {
  it("restores drained pending localIds and fails the job when memory is unavailable", async () => {
    setupDataRoot();
    const redis = asRedis(new FakeRedis());
    const chatId = "wxuser-memory-down";
    await addPendingLocalIds(redis, chatId, [42]);

    const client = {
      listMessages: async () =>
        [{ localId: 42, isSelf: false, content: "hello" }] as Message[],
    } as unknown as WeChatClient;

    const config = {
      group: defaultGroup,
      memoryHealth: { requireAvailable: async () => false },
    } as unknown as PiWeChatConfig;

    const manager = {
      isMaintainerChat: () => false,
      getGroupBuffers: () => new Map(),
      getEscalation: () => undefined,
    } as unknown as SessionManager;

    await assert.rejects(
      handleInboundJob(
        {
          data: { chatId, chatName: "customer", isGroup: false },
          log: async () => 0,
        },
        { redis, client, config, manager },
      ),
      /memory unavailable/,
    );

    assert.deepEqual(await drainPendingLocalIds(redis, chatId), [42]);
  });
});

describe("isDuplicateJobError", () => {
  it("only suppresses BullMQ duplicate job errors", () => {
    assert.equal(
      isDuplicateJobError(new Error("Job wxid already exists")),
      true,
    );
    assert.equal(
      isDuplicateJobError(new Error("Connection is not ready to process jobs")),
      false,
    );
  });
});
