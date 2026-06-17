import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@/lib/tauri-window", () => ({
  isTauri: () => true,
}))

import { searchWikiFederated } from "@/lib/search-wiki-federated"

beforeEach(() => {
  mockInvoke.mockReset()
})

function mockFederatedInvoke(
  handler: (
    args: Record<string, unknown>,
  ) => Array<{
    path: string
    score: number
    title?: string
    projectPath: string
    projectName?: string
  }>,
) {
  mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "wiki_search_federated") {
      throw new Error(`unexpected command ${cmd}`)
    }
    const results = handler(args)
    return results.map((r, index) => ({
      path: r.path,
      title: r.title ?? "t",
      snippet: "s",
      titleMatch: true,
      score: 1 / (60 + index + 1),
      rrfScore: 1 / (60 + index + 1),
      projectPath: r.projectPath,
      projectName: r.projectName,
      libraryRank: index + 1,
      rawScore: r.score,
      relPath: r.path.replace(`${r.projectPath}/`, ""),
      images: [],
    }))
  })
}

describe("searchWikiFederated", () => {
  it("searches each library and fuses with RRF via Rust command", async () => {
    mockFederatedInvoke(() => [
      {
        path: "/proj/a/wiki/a.md",
        score: 0.99,
        title: "A",
        projectPath: "/proj/a",
        projectName: "A",
      },
      {
        path: "/proj/b/wiki/b.md",
        score: 0.5,
        title: "B",
        projectPath: "/proj/b",
        projectName: "B",
      },
    ])

    const out = await searchWikiFederated(
      [
        { projectPath: "/proj/a", projectName: "A" },
        { projectPath: "/proj/b", projectName: "B" },
      ],
      "refund",
      10,
    )

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith(
      "wiki_search_federated",
      expect.objectContaining({
        query: "refund",
        topK: 10,
      }),
    )
    expect(out).toHaveLength(2)
    expect(out[0]?.rrfScore).toBeCloseTo(out[1]?.rrfScore ?? 0)
    expect(out.some((r) => r.projectName === "B" && r.rawScore === 0.5)).toBe(
      true,
    )
  })

  it("passes topK to Rust federated command", async () => {
    mockFederatedInvoke(() => [])

    await searchWikiFederated(
      [
        { projectPath: "/p1" },
        { projectPath: "/p2" },
        { projectPath: "/p3" },
      ],
      "q",
      20,
    )

    expect(mockInvoke).toHaveBeenCalledWith(
      "wiki_search_federated",
      expect.objectContaining({ topK: 20 }),
    )
  })

  it("single library delegates through Rust command", async () => {
    mockFederatedInvoke(() => [
      {
        path: "/only/wiki/x.md",
        score: 0.8,
        title: "X",
        projectPath: "/only",
      },
    ])

    const out = await searchWikiFederated([{ projectPath: "/only" }], "x", 5)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(out[0]?.path).toBe("/only/wiki/x.md")
    expect(out[0]?.rrfScore).toBeCloseTo(1 / 61)
  })
})
