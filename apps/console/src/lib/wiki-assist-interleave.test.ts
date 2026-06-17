import { describe, expect, it } from "vitest"
import {
  interleavePagesByBudget,
  splitLibraryBudgets,
} from "@/lib/wiki-assist-interleave"
import { computeContextBudget } from "@/lib/context-budget"

describe("splitLibraryBudgets", () => {
  it("splits page and index budget evenly across libraries", () => {
    const budget = computeContextBudget(200_000)
    const split = splitLibraryBudgets(budget, 2)
    expect(split.pageBudget).toBe(Math.floor(budget.pageBudget / 2))
    expect(split.indexBudget).toBe(Math.max(256, Math.floor(budget.indexBudget / 2)))
    expect(split.maxPageSize).toBe(budget.maxPageSize)
  })

  it("degenerates to full budget for a single library", () => {
    const budget = computeContextBudget(100_000)
    const split = splitLibraryBudgets(budget, 1)
    expect(split.pageBudget).toBe(budget.pageBudget)
    expect(split.indexBudget).toBe(budget.indexBudget)
  })
})

describe("interleavePagesByBudget", () => {
  it("interleaves A Rank1 then B Rank1 before deeper ranks", () => {
    const picked = interleavePagesByBudget(
      [
        { chunks: [{ title: "A1", size: 100 }, { title: "A2", size: 100 }] },
        { chunks: [{ title: "B1", size: 100 }, { title: "B2", size: 100 }] },
      ],
      500,
      1_000,
      200,
    )
    expect(picked.map((p) => p.title)).toEqual(["A1", "B1", "A2", "B2"])
  })

  it("prevents one long library from starving others (per-lib quota + chunk cap)", () => {
    const picked = interleavePagesByBudget(
      [
        {
          chunks: [
            { title: "A-long", size: 4_000 },
            { title: "A-short", size: 200 },
          ],
        },
        { chunks: [{ title: "B-short", size: 200 }] },
      ],
      1_000,
      2_000,
      800,
    )

    expect(picked.some((p) => p.libraryIndex === 0)).toBe(true)
    expect(picked.some((p) => p.libraryIndex === 1)).toBe(true)
    expect(picked[0]!.title).toBe("A-long")
    expect(picked[0]!.contentLength).toBe(800)
    expect(picked[1]!.title).toBe("B-short")

    const usedA = picked
      .filter((p) => p.libraryIndex === 0)
      .reduce((sum, p) => sum + p.contentLength, 0)
    const usedB = picked
      .filter((p) => p.libraryIndex === 1)
      .reduce((sum, p) => sum + p.contentLength, 0)
    expect(usedA).toBeLessThanOrEqual(1_000)
    expect(usedB).toBeLessThanOrEqual(1_000)
    expect(usedB).toBeGreaterThan(0)
  })

  it("stops when all library queues and budgets are exhausted", () => {
    const picked = interleavePagesByBudget(
      [{ chunks: [{ title: "only", size: 300 }] }],
      200,
      500,
      800,
    )
    expect(picked).toEqual([{ libraryIndex: 0, title: "only", contentLength: 200 }])
  })
})
