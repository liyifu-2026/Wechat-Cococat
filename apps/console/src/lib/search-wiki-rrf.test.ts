import { describe, expect, it } from "vitest"
import {
  FEDERATED_RRF_K,
  fuseFederatedRrf,
  mergeByRawScore,
} from "@/lib/search-wiki-rrf"
import { stubSearchResult } from "@/lib/search-wiki-federated"

describe("fuseFederatedRrf", () => {
  it("uses k=60 matching Rust backend", () => {
    expect(FEDERATED_RRF_K).toBe(60)
  })

  it("assigns equal RRF to rank-1 hits from different libraries regardless of raw score", () => {
    const fused = fuseFederatedRrf([
      {
        projectPath: "/data/tiny-faq",
        projectName: "FAQ",
        results: [stubSearchResult("/data/tiny-faq/wiki/generic.md", 0.95)],
      },
      {
        projectPath: "/data/huge-ops",
        projectName: "Ops",
        results: [
          stubSearchResult("/data/huge-ops/wiki/refund-policy.md", 0.72),
        ],
      },
    ])

    const faq = fused.find((r) => r.path.includes("generic"))
    const ops = fused.find((r) => r.path.includes("refund"))
    expect(faq?.rrfScore).toBeCloseTo(1 / (60 + 1))
    expect(ops?.rrfScore).toBeCloseTo(1 / (60 + 1))
    expect(faq?.rawScore).toBe(0.95)
    expect(ops?.rawScore).toBe(0.72)
  })

  it("prefers rank-1 from large library over rank-10 from small library despite raw scores", () => {
    const tinyResults = Array.from({ length: 10 }, (_, i) =>
      stubSearchResult(
        `/data/tiny/wiki/doc-${i}.md`,
        0.99 - i * 0.01,
        `doc-${i}`,
      ),
    )
    const largeResults = [
      stubSearchResult("/data/large/wiki/precise-hit.md", 0.4, "Precise"),
    ]

    const fused = fuseFederatedRrf([
      { projectPath: "/data/tiny", projectName: "Tiny", results: tinyResults },
      {
        projectPath: "/data/large",
        projectName: "Large",
        results: largeResults,
      },
    ])

    expect(fused[0]?.path).toContain("precise-hit")
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 61)
    expect(fused.find((r) => r.path.includes("doc-9"))?.libraryRank).toBe(10)
  })

  it("raw-score merge would let tiny library霸榜 — RRF does not", () => {
    const tinyResults = Array.from({ length: 5 }, (_, i) =>
      stubSearchResult(`/tiny/wiki/a-${i}.md`, 0.9 - i * 0.01),
    )
    const largeResults = [
      stubSearchResult("/large/wiki/target.md", 0.35),
      stubSearchResult("/large/wiki/other.md", 0.34),
    ]

    const naiveTop = mergeByRawScore([...tinyResults, ...largeResults])[0]
    expect(naiveTop.path).toMatch(/^\/tiny\//)

    const fusedTop = fuseFederatedRrf([
      { projectPath: "/tiny", results: tinyResults },
      { projectPath: "/large", results: largeResults },
    ])[0]
    expect(fusedTop.path).toContain("target")
  })

  it("populates projectPath and relPath metadata", () => {
    const fused = fuseFederatedRrf([
      {
        projectPath: "/proj/a",
        projectName: "Alpha",
        results: [stubSearchResult("/proj/a/wiki/entities/foo.md", 0.5)],
      },
    ])
    expect(fused[0]?.projectPath).toBe("/proj/a")
    expect(fused[0]?.projectName).toBe("Alpha")
    expect(fused[0]?.relPath).toBe("wiki/entities/foo.md")
    expect(fused[0]?.libraryRank).toBe(1)
  })
})
