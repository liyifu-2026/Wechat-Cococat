import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentScopePayload,
  extractPurposeFromOverview,
  extractTagsAndPathHints,
} from "./agent-scope.js";

describe("extractPurposeFromOverview", () => {
  it("takes first two non-empty paragraphs from body", () => {
    const overview = `---
type: overview
title: FAQ
---

# Overview

售后政策与退款流程说明。

API 限流与套餐定价文档。`;

    assert.equal(
      extractPurposeFromOverview(overview),
      "售后政策与退款流程说明。 API 限流与套餐定价文档。",
    );
  });
});

describe("extractTagsAndPathHints", () => {
  it("parses wikilinks and descriptions from index lines", () => {
    const index = `# Wiki Index

## Concepts

- [[refund-policy]] — 退款政策说明
- [[pricing]] — 定价套餐
`;

    const { tags, pathHints } = extractTagsAndPathHints(index);
    assert.ok(pathHints.includes("wiki/refund-policy"));
    assert.ok(pathHints.includes("wiki/pricing"));
    assert.ok(tags.includes("refund policy"));
    assert.ok(tags.includes("退款政策说明"));
    assert.ok(tags.includes("定价套餐"));
  });
});

describe("buildAgentScopePayload", () => {
  it("builds stable hash", () => {
    const payload = buildAgentScopePayload({
      overview: "# Overview\n\n测试知识库。",
      indexContent: "- [[a]] — 标签A\n",
      now: new Date("2026-06-13T00:00:00.000Z"),
    });

    assert.equal(payload.version, 1);
    assert.equal(payload.purpose, "测试知识库。");
    assert.match(payload.indexHash, /^[a-f0-9]{64}$/);
  });
});
