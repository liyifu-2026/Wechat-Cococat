import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampOpsReply,
  formatOpsScopeReply,
  parseMaintainerWikiCommand,
  tryMaintainerWikiOpsReply,
} from "./wiki-sniff.js";
import type { WikiClient } from "../wiki-client.js";

describe("parseMaintainerWikiCommand", () => {
  it("parses scope, search, and read", () => {
    assert.deepEqual(parseMaintainerWikiCommand("scope"), { type: "scope" });
    assert.deepEqual(parseMaintainerWikiCommand("搜 退款"), {
      type: "search",
      query: "退款",
    });
    assert.deepEqual(parseMaintainerWikiCommand("读 FAQ/wiki/refund"), {
      type: "read",
      path: "FAQ/wiki/refund",
    });
    assert.equal(parseMaintainerWikiCommand("列表"), null);
  });
});

describe("formatOpsScopeReply", () => {
  it("shows empty hint when no projects", () => {
    const text = formatOpsScopeReply([]);
    assert.match(text, /未发现已注册 Wiki 项目/);
  });

  it("renders purpose and tags", () => {
    const text = formatOpsScopeReply([
      {
        alias: "FAQ",
        projectId: "uuid-1234-5678",
        scope: {
          version: 1,
          indexHash: "abc",
          updatedAt: "2026-01-01T00:00:00.000Z",
          purpose: "售后政策",
          tags: ["退款", "发票"],
          pathHints: ["wiki/refund"],
        },
      },
    ]);
    assert.match(text, /FAQ/);
    assert.match(text, /售后政策/);
    assert.match(text, /退款, 发票/);
  });
});

describe("tryMaintainerWikiOpsReply", () => {
  it("returns wiki disabled hint for scope when wiki off", async () => {
    const reply = await tryMaintainerWikiOpsReply("scope", undefined, false);
    assert.match(reply ?? "", /Wiki 嗅探未启用/);
  });

  it("delegates search to WikiClient", async () => {
    const mock: Pick<WikiClient, "syncRegistry" | "pickDefaultAliases" | "getRegistry" | "setProjectAliases" | "search"> = {
      syncRegistry: async () => new Map([["FAQ", "id-1"]]),
      pickDefaultAliases: () => ["FAQ"],
      getRegistry: () => new Map([["FAQ", "id-1"]]),
      setProjectAliases: () => {},
      search: async (q: string) => `[1] FAQ/wiki/refund (score: 0.900)\npreview for ${q}`,
    };
    const reply = await tryMaintainerWikiOpsReply(
      "搜 退款",
      mock as WikiClient,
      true,
    );
    assert.match(reply ?? "", /【搜：退款】/);
    assert.match(reply ?? "", /0\.900/);
  });
});

describe("clampOpsReply", () => {
  it("truncates long replies", () => {
    const out = clampOpsReply("x".repeat(4000));
    assert.ok(out.length <= 3500);
    assert.match(out, /已截断/);
  });
});
