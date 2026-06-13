import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  WikiContextManager,
  formatWikiScopePrompt,
  writeWikiScopeSnapshot,
} from "./wiki-context.js";

describe("formatWikiScopePrompt", () => {
  it("renders aliases, tags, and behavior rules", () => {
    const prompt = formatWikiScopePrompt([
      {
        alias: "FAQ",
        scope: {
          version: 1,
          indexHash: "abc",
          updatedAt: "2026-06-13T00:00:00.000Z",
          purpose: "售后与政策",
          tags: ["退款", "发票"],
          pathHints: ["wiki/refund"],
        },
      },
    ]);

    assert.match(prompt, /知识库别名: FAQ/);
    assert.match(prompt, /覆盖核心概念: \[退款, 发票\]/);
    assert.match(prompt, /wiki_search/);
    assert.doesNotMatch(prompt, /WIKI_SYSTEM_PROMPT_APPEND/);
  });
});

describe("WikiContextManager", () => {
  let prevDataDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    prevDataDir = process.env.COCOCAT_DATA_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "wiki-scope-test-"));
    process.env.COCOCAT_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) {
      delete process.env.COCOCAT_DATA_DIR;
    } else {
      process.env.COCOCAT_DATA_DIR = prevDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads scope from shared snapshot and caches by mtime", () => {
    writeWikiScopeSnapshot("proj-1", {
      version: 1,
      purpose: "产品文档",
      tags: ["定价"],
      pathHints: ["wiki/pricing"],
    });

    const manager = new WikiContextManager();
    const registry = new Map([["工作", "proj-1"]]);
    const prompt = manager.buildScopePrompt(["工作"], registry);

    assert.match(prompt, /产品文档/);
    assert.match(prompt, /定价/);

    manager.invalidateCache("工作");
    const again = manager.buildScopePrompt(["工作"], registry);
    assert.match(again, /产品文档/);
  });
});
