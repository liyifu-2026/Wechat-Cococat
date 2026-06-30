import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { readChatPersonaForSession } from "./persona.js";

describe("readChatPersonaForSession", () => {
  test("drops stale memory blocks from another session", () => {
    const dir = mkdtempSync(join(tmpdir(), "cococat-persona-"));
    const path = join(dir, "persona.md");
    writeFileSync(
      path,
      `## 核心性格

客服口吻。

## 相处记忆

---
**[user]** Session: wxid_other [2026-06-23T00:00:00.000Z] (score: 0.8)

用户叫小利。
`,
      "utf8",
    );

    const persona = readChatPersonaForSession(path, "wxid_current");

    assert.match(persona, /客服口吻/);
    assert.doesNotMatch(persona, /小利/);
    assert.match(persona, /## 相处记忆/);
  });
});
