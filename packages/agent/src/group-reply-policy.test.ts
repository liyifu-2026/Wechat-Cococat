import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@cococat/shared";
import { ensureChatContext } from "./chat-store.js";
import type { GroupConfig } from "./group-config.js";
import {
  applyGroupInbound,
  buildOutboundMentions,
  resolveGroupPolicy,
  resolveReplyMentions,
} from "./group-reply-policy.js";

const defaultGroup: GroupConfig = {
  defaultPolicy: { requireMention: true, replyWithMention: "trigger" },
  groupOverrides: new Map(),
  groupsConfigPath: "",
  groupHistoryLimit: 50,
};

describe("group-reply-policy", () => {
  it("resolveGroupPolicy applies member groupMode override", () => {
    const chatCtx = ensureChatContext("member-mode@test");
    chatCtx.style.groupMode = "member";
    const policy = resolveGroupPolicy(defaultGroup, chatCtx.chatId, chatCtx);
    assert.equal(policy.requireMention, false);
    assert.equal(policy.replyWithMention, "none");
  });

  it("applyGroupInbound buffers when mention required", () => {
    const chatId = "12345@chatroom";
    const buffers = new Map<string, Message[]>();
    const chatCtx = ensureChatContext(chatId);
    const unseen = [
      { localId: 1, isSelf: false, content: "hi", senderName: "A" },
    ] as Message[];

    const result = applyGroupInbound({
      chatId,
      isGroup: true,
      unseen,
      group: defaultGroup,
      groupBuffers: buffers,
      chatCtx,
      mode: "fast",
    });

    assert.equal(result.action, "buffer");
    assert.equal(buffers.get(chatId)?.length, 1);
  });

  it("buildOutboundMentions resolves trigger mention", () => {
    const unseen = [
      {
        localId: 2,
        isSelf: false,
        content: "@Bob\u2005帮忙",
        isMentioned: true,
        senderName: "Bob",
      },
    ] as Message[];

    const names = resolveReplyMentions(
      [{ senderName: "Bob", isMentioned: true }],
      { requireMention: true, replyWithMention: "trigger" },
    );
    assert.deepEqual(names, ["Bob"]);

    const outbound = buildOutboundMentions(true, unseen, {
      requireMention: true,
      replyWithMention: "trigger",
    });
    assert.deepEqual(outbound, ["Bob"]);
  });
});
