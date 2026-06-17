/**
 * M2 · P1 acceptance smoke — ties per-chat resolve → federated RRF →
 * interleaved budget → absolute expand paths (no UI / Tauri).
 */
import { describe, expect, it, vi } from "vitest"
import { interleavePagesByBudget } from "@/lib/wiki-assist-interleave"
import { fuseFederatedRrf, mergeByRawScore } from "@/lib/search-wiki-rrf"
import { searchWikiFederated, stubSearchResult } from "@/lib/search-wiki-federated"
import { resolveWikiAliasesSync } from "@/lib/resolve-inbox-chat-wiki"
import {
  resolveWikiAbsolutePath,
  wikiReferenceAbsolutePath,
} from "@/lib/wiki-reference-path"
import type { ProjectRegistry } from "@/lib/project-identity"

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
}))

import { searchWiki } from "@/lib/search"

const registry: ProjectRegistry = {
  "id-a": {
    id: "id-a",
    path: "/wikis/库A",
    name: "库A",
    lastOpened: 1,
  },
  "id-b": {
    id: "id-b",
    path: "/wikis/库B",
    name: "库B",
    lastOpened: 2,
  },
}

describe("M2 P1 acceptance smoke", () => {
  it("dual-library alias resolve → federated RRF → both libraries represented", async () => {
    const resolved = resolveWikiAliasesSync(
      ["库A", "库B"],
      { 库A: "id-a", 库B: "id-b" },
      registry,
    )
    expect(resolved.status).toBe("ok")
    expect(resolved.resolved).toHaveLength(2)

    vi.mocked(searchWiki).mockImplementation(async (projectPath: string) => {
      if (projectPath.includes("库A")) {
        return [stubSearchResult(`${projectPath}/wiki/only-in-a.md`, 0.42, "词条A")]
      }
      return [stubSearchResult(`${projectPath}/wiki/only-in-b.md`, 0.99, "词条B")]
    })

    const results = await searchWikiFederated(
      resolved.resolved.map((p) => ({
        projectPath: p.projectPath,
        projectName: p.name,
      })),
      "测试",
      10,
    )

    expect(results.some((r) => r.projectPath.includes("库A"))).toBe(true)
    expect(results.some((r) => r.projectPath.includes("库B"))).toBe(true)

    const rawMerged = mergeByRawScore([
      stubSearchResult("/wikis/库B/wiki/only-in-b.md", 0.99, "词条B"),
      stubSearchResult("/wikis/库A/wiki/only-in-a.md", 0.42, "词条A"),
    ])
    expect(rawMerged[0]?.path).toContain("库B")

    const rrf = fuseFederatedRrf([
      {
        projectPath: "/wikis/库A",
        results: [stubSearchResult("/wikis/库A/wiki/only-in-a.md", 0.42, "词条A")],
      },
      {
        projectPath: "/wikis/库B",
        results: [
          stubSearchResult("/wikis/库B/wiki/noise.md", 0.99, "noise"),
          stubSearchResult("/wikis/库B/wiki/only-in-b.md", 0.99, "词条B"),
        ],
      },
    ])
    expect(rrf[0]?.title).toBe("词条A")
  })

  it("interleaved assist budget includes both libraries when one has a long page", () => {
    const picked = interleavePagesByBudget(
      [
        { chunks: [{ title: "A-long", size: 4_000 }, { title: "A-short", size: 100 }] },
        { chunks: [{ title: "B-short", size: 150 }] },
      ],
      1_000,
      2_000,
      800,
    )
    const libs = new Set(picked.map((p) => p.libraryIndex))
    expect(libs.has(0)).toBe(true)
    expect(libs.has(1)).toBe(true)
    expect(picked[0]?.title).toBe("A-long")
    expect(picked[1]?.title).toBe("B-short")
  })

  it("expand uses absolute projectPath/relPath (not alias/path wire format)", () => {
    const absolute = wikiReferenceAbsolutePath({
      path: "ignored",
      projectPath: "/wikis/库A",
      relPath: "wiki/faq/refund.md",
    })
    expect(absolute).toBe("/wikis/库A/wiki/faq/refund.md")
    expect(absolute).not.toMatch(/^库A\//)
    expect(
      resolveWikiAbsolutePath({
        path: "/wikis/库A/wiki/faq/refund.md",
      }),
    ).toBe("/wikis/库A/wiki/faq/refund.md")
  })
})
