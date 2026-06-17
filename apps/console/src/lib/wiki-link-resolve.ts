import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

const WIKI_DIRS = [
  "entities",
  "concepts",
  "sources",
  "queries",
  "synthesis",
  "comparisons",
] as const

function wikiCandidates(pp: string, pageName: string): string[] {
  const trimmed = pageName.trim()
  if (trimmed.includes("/")) {
    const rel = trimmed.replace(/\.md$/i, "")
    return [`${pp}/wiki/${rel}.md`, `${pp}/${rel}.md`]
  }
  return [
    ...WIKI_DIRS.map((dir) => `${pp}/wiki/${dir}/${trimmed}.md`),
    `${pp}/wiki/${trimmed}.md`,
  ]
}

/** Resolve a [[wikilink]] target to an absolute file path, if it exists. */
export async function resolveWikiPagePath(
  pageName: string,
  projectPath?: string | null,
): Promise<string | null> {
  if (!projectPath?.trim()) return null
  const pp = normalizePath(projectPath)
  for (const candidate of wikiCandidates(pp, pageName)) {
    try {
      await readFile(candidate)
      return candidate
    } catch {
      // try next
    }
  }
  return null
}

/** Convert [[wikilinks]] in markdown to wikilink: protocol links for ReactMarkdown. */
export function preprocessWikilinks(text: string): string {
  let result = text.replace(/\[\[([^\]]+)\](?!\])/g, "[[$1]]")
  return result.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, pageName: string, displayText?: string) => {
      const display = displayText?.trim() || pageName.trim()
      return `[${display}](wikilink:${pageName.trim()})`
    },
  )
}
