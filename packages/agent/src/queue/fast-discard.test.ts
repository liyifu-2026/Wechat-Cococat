import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message, WeChatClient } from "@cococat/shared";
import { recordAutoReply } from "../reply-guard.js";
import { evaluateInboundFastDiscard } from "./fast-discard.js";
import type { GroupConfig } from "../group-config.js";

function mockClient(messages: Message[]): WeChatClient {
  return {
    listMessages: async () => messages,
  } as unknown as WeChatClient;
}

const defaultGroup: GroupConfig = {
  defaultPolicy: { requireMention: true, replyWithMention: "none" },
  groupOverrides: new Map(),
  groupsConfigPath: "",
  groupHistoryLimit: 50,
};

describe("fast-discard", () => {
  it("discards on cooling down when not mentioned", async () => {
    const chatId = "fast-discard-cool@test";
    recordAutoReply(chatId);

    const messages = [
      { localId: 10, isSelf: false, content: "hi" },
    ] as Message[];

    const result = await evaluateInboundFastDiscard({
      client: mockClient(messages),
      group: defaultGroup,
      groupBuffers: new Map(),
      chatId,
      chatName: "test",
      isGroup: false,
      snapshotLocalIds: [10],
    });

    assert.equal(result?.reason, "cooling_down");
    assert.deepEqual(result?.localIds, [10]);
  });

  it("buffers group messages without mention", async () => {
    const chatId = "12345@chatroom";
    const buffers = new Map<string, Message[]>();
    const messages = [
      {
        localId: 5,
        isSelf: false,
        content: "闲聊",
        senderName: "Alice",
      },
    ] as Message[];

    const result = await evaluateInboundFastDiscard({
      client: mockClient(messages),
      group: defaultGroup,
      groupBuffers: buffers,
      chatId,
      chatName: "群",
      isGroup: true,
      snapshotLocalIds: [5],
    });

    assert.equal(result?.reason, "group_buffer");
    assert.equal(buffers.get(chatId)?.length, 1);
  });

  it("does not discard when mentioned during cooldown", async () => {
    const chatId = "67890@chatroom";
    recordAutoReply(chatId);

    const messages = [
      {
        localId: 7,
        isSelf: false,
        content: "@bot 帮忙",
        isMentioned: true,
        senderName: "Bob",
      },
    ] as Message[];

    const result = await evaluateInboundFastDiscard({
      client: mockClient(messages),
      group: defaultGroup,
      groupBuffers: new Map(),
      chatId,
      chatName: "群",
      isGroup: true,
      snapshotLocalIds: [7],
    });

    assert.equal(result, undefined);
  });
});
