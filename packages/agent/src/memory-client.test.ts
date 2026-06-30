import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { filterMemoryTextForSession } from "./memory-session-filter.js";

describe("filterMemoryTextForSession", () => {
  test("keeps blocks for the requested session", () => {
    const text = `Found 1 matching message(s):

---
**[user]** Session: wxid_current [2026-06-23T00:00:00.000Z] (score: 0.8)

当前用户喜欢短句回复。`;

    const filtered = filterMemoryTextForSession("wxid_current", text);

    assert.match(filtered ?? "", /当前用户喜欢短句回复/);
    assert.match(filtered ?? "", /Session: wxid_current/);
  });

  test("drops blocks from other sessions", () => {
    const text = `Found 1 matching message(s):

---
**[user]** Session: wxid_other [2026-06-23T00:00:00.000Z] (score: 0.8)

用户叫小利。`;

    assert.equal(filterMemoryTextForSession("wxid_current", text), undefined);
  });

  test("drops unproven global summaries without session markers", () => {
    const text = `# User Narrative Profile

> 基本信息
- 用户名：Leaif
- 昵称：小利`;

    assert.equal(filterMemoryTextForSession("wxid_current", text), undefined);
  });

  test("keeps only matching blocks when mixed sessions are returned", () => {
    const text = `Found 2 matching message(s):

---
**[user]** Session: wxid_other [2026-06-23T00:00:00.000Z] (score: 0.8)

用户叫小利。

---
**[assistant]** Session: wxid_current [2026-06-23T00:00:01.000Z] (score: 0.7)

当前客户问过退款。`;

    const filtered = filterMemoryTextForSession("wxid_current", text);

    assert.doesNotMatch(filtered ?? "", /小利/);
    assert.match(filtered ?? "", /当前客户问过退款/);
  });
});
