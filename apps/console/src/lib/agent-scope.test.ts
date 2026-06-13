import { describe, expect, it } from "vitest"
import {
  buildAgentScopePayload,
  extractPurposeFromOverview,
  extractTagsAndPathHints,
} from "./agent-scope"

describe("extractPurposeFromOverview", () => {
  it("takes first two non-empty paragraphs from body", () => {
    const overview = `---
type: overview
title: FAQ
---

# Overview

售后政策与退款流程说明。

API 限流与套餐定价文档。`

    expect(extractPurposeFromOverview(overview)).toBe(
      "售后政策与退款流程说明。 API 限流与套餐定价文档。",
    )
  })
})

describe("extractTagsAndPathHints", () => {
  it("parses wikilinks and descriptions from index lines", () => {
    const index = `# Wiki Index

## Concepts

- [[refund-policy]] — 退款政策说明
- [[pricing]] — 定价套餐
`

    const { tags, pathHints } = extractTagsAndPathHints(index)
    expect(pathHints).toContain("wiki/refund-policy")
    expect(pathHints).toContain("wiki/pricing")
    expect(tags).toContain("refund policy")
    expect(tags).toContain("退款政策说明")
    expect(tags).toContain("定价套餐")
  })
})

describe("buildAgentScopePayload", () => {
  it("builds stable hash and caps field sizes", () => {
    const payload = buildAgentScopePayload({
      overview: "# Overview\n\n测试知识库。",
      indexContent: "- [[a]] — 标签A\n",
      now: new Date("2026-06-13T00:00:00.000Z"),
    })

    expect(payload.version).toBe(1)
    expect(payload.source).toBe("ingest-rules")
    expect(payload.purpose).toBe("测试知识库。")
    expect(payload.indexHash).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.updatedAt).toBe("2026-06-13T00:00:00.000Z")
  })
})
