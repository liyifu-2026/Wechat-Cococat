import type { SearchResult } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"

/** Matches Rust `RRF_K` in `commands/search.rs`. */
export const FEDERATED_RRF_K = 60

export type RankedLibraryResults = {
  projectPath: string
  projectName?: string
  results: SearchResult[]
}

export type FederatedSearchResult = SearchResult & {
  /** Cross-library RRF score used for final ordering. */
  rrfScore: number
  projectPath: string
  projectName?: string
  /** 1-based rank within the source library's result list. */
  libraryRank: number
  /** Original per-library score before federation (debug / badges). */
  rawScore: number
  /** Path relative to `projectPath` when under that root. */
  relPath: string
}

function relPathForProject(projectPath: string, absolutePath: string): string {
  const root = normalizePath(projectPath).replace(/\/+$/, "")
  const full = normalizePath(absolutePath)
  if (full.startsWith(`${root}/`)) {
    return full.slice(root.length + 1)
  }
  return full
}

/**
 * Reciprocal Rank Fusion across per-library ranked lists.
 * Do NOT sort federated results by raw `score` — ranks only.
 */
export function fuseFederatedRrf(
  libraries: RankedLibraryResults[],
  k = FEDERATED_RRF_K,
): FederatedSearchResult[] {
  const merged = new Map<
    string,
    {
      rrfScore: number
      result: SearchResult
      projectPath: string
      projectName?: string
      libraryRank: number
    }
  >()

  for (const library of libraries) {
    const projectPath = normalizePath(library.projectPath)
    library.results.forEach((result, index) => {
      const rank = index + 1
      const contribution = 1 / (k + rank)
      const key = normalizePath(result.path)
      const existing = merged.get(key)
      if (existing) {
        existing.rrfScore += contribution
        return
      }
      merged.set(key, {
        rrfScore: contribution,
        result,
        projectPath,
        projectName: library.projectName,
        libraryRank: rank,
      })
    })
  }

  return [...merged.values()]
    .sort(
      (a, b) =>
        b.rrfScore - a.rrfScore ||
        a.result.path.localeCompare(b.result.path),
    )
    .map(({ rrfScore, result, projectPath, projectName, libraryRank }) => ({
      ...result,
      rrfScore,
      score: rrfScore,
      projectPath,
      projectName,
      libraryRank,
      rawScore: result.score,
      relPath: relPathForProject(projectPath, result.path),
    }))
}

/** Naive merge by raw score — used in tests to demonstrate the霸榜 failure mode. */
export function mergeByRawScore(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => b.score - a.score)
}
