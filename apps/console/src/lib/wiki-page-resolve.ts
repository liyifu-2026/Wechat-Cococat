import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"

export interface WikiDeepLinkResolveInput {
  wikiPath?: string | null
  topic?: string | null
}

function flattenMdFiles(nodes: FileNode[]): { name: string; path: string }[] {
  const files: { name: string; path: string }[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push({ name: node.name, path: node.path })
    }
  }
  return files
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase()
}

function pathMatchesFile(normalizedTarget: string, filePath: string): boolean {
  const normalizedFile = normalizePath(filePath).toLowerCase()
  if (normalizedFile === normalizedTarget) return true
  if (normalizedFile.endsWith(normalizedTarget)) return true
  return normalizedFile.includes(normalizedTarget)
}

/**
 * Resolve an explicit wiki path against the indexed file tree.
 * Falls back to the normalized path when it already looks like a markdown file.
 */
export function resolveWikiPathByExplicitPath(
  fileTree: FileNode[],
  wikiPath: string,
): string | null {
  const raw = wikiPath.trim()
  if (!raw) return null

  const normalized = normalizePath(raw)
  const mdFiles = flattenMdFiles(fileTree)
  const hit = mdFiles.find((f) => pathMatchesFile(normalized, f.path))
  if (hit) return hit.path

  if (normalized.endsWith(".md")) return normalized
  return null
}

/**
 * Fuzzy topic → markdown file path.
 * 1. exact stem match (refund → refund.md)
 * 2. filename contains topic
 * 3. full path contains topic
 */
export function resolveWikiPathByTopic(
  fileTree: FileNode[],
  topic: string,
): string | null {
  const cleanTopic = normalizeTopic(topic)
  if (!cleanTopic) return null

  const mdFiles = flattenMdFiles(fileTree)

  const exactStem = mdFiles.find(
    (f) => f.name.toLowerCase().replace(/\.md$/, "") === cleanTopic,
  )
  if (exactStem) return exactStem.path

  const nameHit = mdFiles.find((f) => f.name.toLowerCase().includes(cleanTopic))
  if (nameHit) return nameHit.path

  const pathHit = mdFiles.find((f) =>
    normalizePath(f.path).toLowerCase().includes(cleanTopic),
  )
  if (pathHit) return pathHit.path

  return null
}

/** Prefer explicit wikiPath; otherwise fuzzy topic match. */
export function resolveWikiDeepLink(
  fileTree: FileNode[],
  input: WikiDeepLinkResolveInput,
): string | null {
  if (input.wikiPath?.trim()) {
    return resolveWikiPathByExplicitPath(fileTree, input.wikiPath)
  }
  if (input.topic?.trim()) {
    return resolveWikiPathByTopic(fileTree, input.topic)
  }
  return null
}
