import { invoke } from "@tauri-apps/api/core"
import { searchWiki, type SearchResult } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"
import {
  fuseFederatedRrf,
  type FederatedSearchResult,
} from "@/lib/search-wiki-rrf"
import { isTauri } from "@/lib/tauri-window"
import { useWikiStore } from "@/stores/wiki-store"

export type FederatedWikiProject = {
  projectPath: string
  projectName?: string
}

type RustFederatedSearchResultItem = {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
  rrfScore: number
  projectPath: string
  projectName?: string
  libraryRank: number
  rawScore: number
  relPath: string
  images: SearchResult["images"]
  content?: string
}

function mapRustFederatedItem(item: RustFederatedSearchResultItem): FederatedSearchResult {
  return {
    path: item.path,
    title: item.title,
    snippet: item.snippet,
    titleMatch: item.titleMatch,
    score: item.score,
    images: item.images,
    rrfScore: item.rrfScore,
    projectPath: normalizePath(item.projectPath),
    projectName: item.projectName,
    libraryRank: item.libraryRank,
    rawScore: item.rawScore,
    relPath: item.relPath,
  }
}

async function searchWikiFederatedViaRust(
  projects: FederatedWikiProject[],
  query: string,
  topK: number,
): Promise<FederatedSearchResult[]> {
  const embCfg = useWikiStore.getState().embeddingConfig
  const items = await invoke<RustFederatedSearchResultItem[]>("wiki_search_federated", {
    projects: projects.map((project) => ({
      projectPath: normalizePath(project.projectPath),
      projectName: project.projectName,
    })),
    query,
    topK,
    includeContent: false,
    queryEmbedding: null,
    embeddingConfig: embCfg,
  })
  return items.map(mapRustFederatedItem)
}

async function searchWikiFederatedViaTs(
  projects: FederatedWikiProject[],
  query: string,
  topK: number,
): Promise<FederatedSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed || projects.length === 0) return []

  if (projects.length === 1) {
    const only = projects[0]!
    const results = await searchWiki(only.projectPath, trimmed, topK)
    return fuseFederatedRrf([
      {
        projectPath: normalizePath(only.projectPath),
        projectName: only.projectName,
        results,
      },
    ]).slice(0, topK)
  }

  const perLibrary = Math.max(1, Math.ceil(topK / projects.length))
  const libraries = await Promise.all(
    projects.map(async (project) => {
      const projectPath = normalizePath(project.projectPath)
      const results = await searchWiki(projectPath, trimmed, perLibrary)
      return {
        projectPath,
        projectName: project.projectName,
        results,
      }
    }),
  )

  return fuseFederatedRrf(libraries).slice(0, topK)
}

export async function searchWikiFederated(
  projects: FederatedWikiProject[],
  query: string,
  topK = 20,
): Promise<FederatedSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed || projects.length === 0) return []

  if (isTauri()) {
    return searchWikiFederatedViaRust(projects, trimmed, topK)
  }
  return searchWikiFederatedViaTs(projects, trimmed, topK)
}

export type { FederatedSearchResult }

/** @internal test helper */
export function stubSearchResult(
  path: string,
  score: number,
  title = "title",
): SearchResult {
  return {
    path,
    title,
    snippet: title,
    titleMatch: false,
    score,
    images: [],
  }
}
