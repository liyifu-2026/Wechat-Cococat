import type { ContextBudget } from "@/lib/context-budget"

export type WikiAssistProject = {
  projectPath: string
  projectName: string
}

export type InterleavePageChunk = {
  libraryIndex: number
  title: string
  contentLength: number
}

export type InterleaveLibraryInput = {
  chunks: Array<{ title: string; size: number }>
}

/** Per-library slice of the global context budget. */
export function splitLibraryBudgets(
  budget: ContextBudget,
  libraryCount: number,
): { indexBudget: number; pageBudget: number; maxPageSize: number } {
  const n = Math.max(1, libraryCount)
  const indexBudget = Math.max(256, Math.floor(budget.indexBudget / n))
  const pageBudget = Math.floor(budget.pageBudget / n)
  return {
    indexBudget,
    pageBudget,
    maxPageSize: budget.maxPageSize,
  }
}

/**
 * Round-robin page selection: A Rank1 → B Rank1 → A Rank2 → B Rank2 …
 * Each library has an independent `perLibPageBudget`; chunks are capped by
 * `maxPageSize` so one long page cannot consume an entire library quota.
 */
export function interleavePagesByBudget(
  libraries: InterleaveLibraryInput[],
  perLibPageBudget: number,
  totalPageBudget: number,
  maxPageSize: number,
): InterleavePageChunk[] {
  if (libraries.length === 0 || totalPageBudget <= 0 || perLibPageBudget <= 0) {
    return []
  }

  const nextIndex = libraries.map(() => 0)
  const usedPerLib = libraries.map(() => 0)
  const picked: InterleavePageChunk[] = []
  let totalUsed = 0

  while (totalUsed < totalPageBudget) {
    let progressed = false

    for (let libIdx = 0; libIdx < libraries.length; libIdx++) {
      if (totalUsed >= totalPageBudget) break
      if (usedPerLib[libIdx]! >= perLibPageBudget) continue

      const queue = libraries[libIdx]!.chunks
      const idx = nextIndex[libIdx]!
      if (idx >= queue.length) continue

      const chunk = queue[idx]!
      nextIndex[libIdx] = idx + 1

      let size = Math.min(chunk.size, maxPageSize)
      const libRemaining = perLibPageBudget - usedPerLib[libIdx]!
      if (size > libRemaining) size = libRemaining
      const totalRemaining = totalPageBudget - totalUsed
      if (size > totalRemaining) size = totalRemaining
      if (size <= 0) continue

      picked.push({
        libraryIndex: libIdx,
        title: chunk.title,
        contentLength: size,
      })
      usedPerLib[libIdx]! += size
      totalUsed += size
      progressed = true
    }

    if (!progressed) break
  }

  return picked
}

export function formatMultiProjectLabel(projects: WikiAssistProject[]): string {
  if (projects.length === 0) return "wiki"
  if (projects.length === 1) return projects[0]!.projectName
  return projects.map((p) => p.projectName).join(", ")
}
