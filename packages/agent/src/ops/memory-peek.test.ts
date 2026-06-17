import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { Chat, WeChatClient } from "@cococat/shared";
import type { MemoryCandidate } from "../escalation/types.js";

const prevData = process.env.COCOCAT_DATA_DIR;

beforeEach(() => {
  process.env.COCOCAT_DATA_DIR = mkdtempSync(join(tmpdir(), "mem-peek-"));
});

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

async function loadMemoryPeek() {
  return import("./memory-peek.js");
}

describe("parseMaintainerMemoryCommand", () => {
  test("parses 记忆 query", async () => {
    const { parseMaintainerMemoryCommand } = await loadMemoryPeek();
    assert.equal(parseMaintainerMemoryCommand("记忆 张三"), "张三");
    assert.equal(parseMaintainerMemoryCommand("  记忆 wxid_abc  "), "wxid_abc");
    assert.equal(parseMaintainerMemoryCommand("列表"), null);
  });
});

describe("isChatIdQuery", () => {
  test("detects wxid and chatroom ids", async () => {
    const { isChatIdQuery } = await loadMemoryPeek();
    assert.equal(isChatIdQuery("wxid_abc123"), true);
    assert.equal(isChatIdQuery("12345678@chatroom"), true);
    assert.equal(isChatIdQuery("张三"), false);
  });
});

describe("resolveMemoryTarget", () => {
  test("0 hits returns error", async () => {
    const { resolveMemoryTarget } = await loadMemoryPeek();
    const client = {
      findChats: async () => [],
      getChat: async () => null,
    } as unknown as WeChatClient;
    const res = await resolveMemoryTarget("张三", client);
    assert.equal(res.kind, "error");
  });

  test("chatId miss returns error", async () => {
    const { resolveMemoryTarget } = await loadMemoryPeek();
    const client = {
      findChats: async () => [],
      getChat: async () => null,
    } as unknown as WeChatClient;
    const res = await resolveMemoryTarget("wxid_missing", client);
    assert.equal(res.kind, "error");
    if (res.kind === "error") {
      assert.match(res.message, /未找到 chatId/);
    }
  });

  test("chatId hit returns single", async () => {
    const { resolveMemoryTarget } = await loadMemoryPeek();
    const chat: Chat = {
      id: "wxid_abc",
      username: "u",
      name: "张三",
      unreadCount: 0,
      isGroup: false,
    };
    const client = {
      findChats: async () => [],
      getChat: async (id: string) => (id === "wxid_abc" ? chat : null),
    } as unknown as WeChatClient;
    const res = await resolveMemoryTarget("wxid_abc", client);
    assert.equal(res.kind, "single");
  });

  test("2 hits returns pick", async () => {
    const { resolveMemoryTarget } = await loadMemoryPeek();
    const chats: Chat[] = [
      {
        id: "wxid_a",
        username: "a",
        name: "张三",
        unreadCount: 0,
        isGroup: false,
      },
      {
        id: "wxid_b",
        username: "b",
        name: "张三-销售",
        unreadCount: 0,
        isGroup: false,
      },
    ];
    const client = {
      findChats: async () => chats,
      getChat: async () => null,
    } as unknown as WeChatClient;
    const res = await resolveMemoryTarget("张三", client);
    assert.equal(res.kind, "pick");
    if (res.kind === "pick") {
      assert.equal(res.candidates.length, 2);
    }
  });

  test(">5 hits returns too_many", async () => {
    const { resolveMemoryTarget } = await loadMemoryPeek();
    const chats: Chat[] = Array.from({ length: 6 }, (_, i) => ({
      id: `wxid_${i}`,
      username: `u${i}`,
      name: "张三",
      unreadCount: 0,
      isGroup: false,
    }));
    const client = {
      findChats: async () => chats,
      getChat: async () => null,
    } as unknown as WeChatClient;
    const res = await resolveMemoryTarget("张三", client);
    assert.equal(res.kind, "too_many");
    if (res.kind === "too_many") {
      assert.equal(res.count, 6);
    }
  });
});

describe("formatMemoryPickList", () => {
  test("renders numbered list with chatId suffix", async () => {
    const { formatMemoryPickList } = await loadMemoryPeek();
    const candidates: MemoryCandidate[] = [
      {
        chatId: "wxid_abc4",
        chatName: "张三-设计",
        muteLabel: "转人工 · mute 剩 3h",
        profileTags: [],
        lastUserLine: "发票什么时候开",
      },
    ];
    const text = formatMemoryPickList("张三", candidates);
    assert.match(text, /1\) 张三-设计/);
    assert.match(text, /…abc4/);
  });
});

describe("pickMaintainerCandidate", () => {
  test("picks by index and chatId suffix", async () => {
    const { pickMaintainerCandidate } = await import("./pick-candidate.js");
    const candidates = [
      { chatId: "wxid_aaa1", chatName: "A" },
      { chatId: "wxid_bbb9", chatName: "B" },
    ];
    assert.equal(pickMaintainerCandidate(candidates, "2")?.chatName, "B");
    assert.equal(pickMaintainerCandidate(candidates, "bbb9")?.chatName, "B");
    assert.equal(pickMaintainerCandidate(candidates, "zzz"), null);
  });
});
