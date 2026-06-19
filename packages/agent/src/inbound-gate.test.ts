import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cococat/shared";
import { ensureChatContext } from "./chat-store.js";
import type { GroupConfig } from "./group-config.js";
import { recordAutoReply } from "./reply-guard.js";
import { evaluateInboundGate } from "./inbound-gate.js";

const defaultGroup: GroupConfig = {
  defaultPolicy: { requireMention: true, replyWithMention: "none" },
  groupOverrides: new Map(),
  groupsConfigPath: "",
  groupHistoryLimit: 50,
};

const prevData = process.env.COCOCAT_DATA_DIR;

beforeEach(() => {
  process.env.COCOCAT_DATA_DIR = mkdtempSync(join(tmpdir(), "cococat-gate-"));
});

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

describe("inbound-gate", { concurrency: false }, () => {
  it("fast mode discards on cooling down when not mentioned", async () => {
    const chatId = "gate-cool@test";
    recordAutoReply(chatId);
    const chatCtx = ensureChatContext(chatId);
    chatCtx.style.replyCooldownMs = 30_000;
    const unseen = [{ localId: 10, isSelf: false, content: "hi" }] as Message[];

    const result = await evaluateInboundGate({
      chatId,
      chatName: "test",
      isGroup: false,
      unseen,
      group: defaultGroup,
      groupBuffers: new Map(),
      chatCtx,
      transcriptEntries: [],
      mode: "fast",
    });

    assert.equal(result.action, "discard");
    if (result.action === "discard") {
      assert.equal(result.reason, "cooling_down");
    }
  });

  it("fast mode buffers group messages without mention", async () => {
    const chatId = "12345@chatroom";
    const buffers = new Map<string, Message[]>();
    const chatCtx = ensureChatContext(chatId);
    const unseen = [
      {
        localId: 5,
        isSelf: false,
        content: "闲聊",
        senderName: "Alice",
      },
    ] as Message[];

    const result = await evaluateInboundGate({
      chatId,
      chatName: "群",
      isGroup: true,
      unseen,
      group: defaultGroup,
      groupBuffers: buffers,
      chatCtx,
      transcriptEntries: [],
      mode: "fast",
    });

    assert.equal(result.action, "discard");
    if (result.action === "discard") {
      assert.equal(result.reason, "group_buffer");
    }
    assert.equal(buffers.get(chatId)?.length, 1);
  });

  it("full mode drains group buffer when mentioned", async () => {
    const chatId = "67890@chatroom";
    const buffers = new Map<string, Message[]>();
    buffers.set(chatId, [
      { localId: 1, isSelf: false, content: "old", senderName: "A" },
    ] as Message[]);
    const chatCtx = ensureChatContext(chatId);
    const unseen = [
      {
        localId: 7,
        isSelf: false,
        content: "@bot 帮忙",
        isMentioned: true,
        senderName: "Bob",
      },
    ] as Message[];

    const result = await evaluateInboundGate({
      chatId,
      chatName: "群",
      isGroup: true,
      unseen,
      group: defaultGroup,
      groupBuffers: buffers,
      chatCtx,
      transcriptEntries: [],
      mode: "full",
      skipReplyGuard: true,
    });

    assert.equal(result.action, "proceed");
    if (result.action === "proceed") {
      assert.equal(result.injectedBufferCount, 1);
      assert.equal(result.unseen.length, 2);
      assert.equal(buffers.get(chatId)?.length ?? 0, 0);
    }
  });

  it("fast mode proceeds when mentioned during cooldown", async () => {
    const chatId = "99999@chatroom";
    recordAutoReply(chatId);
    const chatCtx = ensureChatContext(chatId);
    const unseen = [
      {
        localId: 7,
        isSelf: false,
        content: "@bot 帮忙",
        isMentioned: true,
        senderName: "Bob",
      },
    ] as Message[];

    const result = await evaluateInboundGate({
      chatId,
      chatName: "群",
      isGroup: true,
      unseen,
      group: defaultGroup,
      groupBuffers: new Map(),
      chatCtx,
      transcriptEntries: [],
      mode: "fast",
    });

    assert.equal(result.action, "proceed");
  });

  it("discards private chat when agent proxy is off", async () => {
    const chatId = "gate-proxy-off@test";
    const chatCtx = ensureChatContext(chatId);
    writeFileSync(
      chatCtx.stylePath,
      JSON.stringify({ agentProxyEnabled: false }, null, 2) + "\n",
      "utf8",
    );
    const unseen = [{ localId: 11, isSelf: false, content: "hi" }] as Message[];

    const result = await evaluateInboundGate({
      chatId,
      chatName: "test",
      isGroup: false,
      unseen,
      group: defaultGroup,
      groupBuffers: new Map(),
      chatCtx,
      transcriptEntries: [],
      mode: "full",
      skipReplyGuard: true,
    });

    assert.equal(result.action, "discard");
    if (result.action === "discard") {
      assert.equal(result.reason, "agent_proxy_off");
      assert.equal(result.shouldMarkSeen, true);
    }
  });
});
