import { getRelativePath, getFileName, isAbsolutePath, joinPath, normalizePath } from "@/lib/path-utils"

export type WikiReferenceOpenMeta = {
  projectPath?: string
  relPath?: string
  projectName?: string
}

export type WikiExpandPathInput = {
  /** Absolute path, or relative path when `projectPath` is set. */
  path: string
  projectPath?: string
  relPath?: string
}

/**
 * Resolve a wiki page to a single absolute filesystem path for readFile.
 * Prefer explicit `relPath` + `projectPath`; accept already-absolute `path`.
 */
export function resolveWikiAbsolutePath(input: WikiExpandPathInput): string {
  const projectPath = input.projectPath
    ? normalizePath(input.projectPath).replace(/\/+$/, "")
    : undefined

  if (input.relPath?.trim() && projectPath) {
    const rel = normalizePath(input.relPath).replace(/^\/+/, "")
    return joinPath(projectPath, rel)
  }

  const path = normalizePath(input.path)
  if (isAbsolutePath(path)) return path

  if (projectPath) {
    return joinPath(projectPath, path.replace(/^\/+/, ""))
  }

  return path
}

export function wikiReferenceToOpenMeta(ref: {
  path: string
  projectPath?: string
  relPath?: string
  projectName?: string
}): WikiReferenceOpenMeta {
  const projectPath = ref.projectPath
    ? normalizePath(ref.projectPath)
    : undefined
  const relPath =
    ref.relPath?.trim() ||
    (projectPath && isAbsolutePath(ref.path)
      ? getRelativePath(ref.path, projectPath)
      : undefined)

  return {
    projectPath,
    relPath: relPath || undefined,
    projectName: ref.projectName,
  }
}

export function wikiReferenceAbsolutePath(ref: {
  path: string
  projectPath?: string
  relPath?: string
}): string {
  return resolveWikiAbsolutePath({
    path: ref.path,
    projectPath: ref.projectPath,
    relPath: ref.relPath,
  })
}

/** Read candidates for a wiki citation — absolute when metadata exists, else Brain fallbacks. */
export function wikiCitationReadCandidates(
  page: { path: string; projectPath?: string; relPath?: string; kind?: string },
  globalProjectPath?: string,
): string[] {
  if (page.kind === "external") return []
  if (page.projectPath || isAbsolutePath(page.path)) {
    return [wikiReferenceAbsolutePath(page)]
  }
  if (!globalProjectPath) return [page.path]

  const pp = normalizePath(globalProjectPath)
  const id = getFileName(page.path.replace(/^wiki\//, "").replace(/\.md$/, ""))
  return [
    joinPath(pp, page.path.replace(/^\//, "")),
    `${pp}/wiki/entities/${id}.md`,
    `${pp}/wiki/concepts/${id}.md`,
    `${pp}/wiki/sources/${id}.md`,
    `${pp}/wiki/queries/${id}.md`,
    `${pp}/wiki/synthesis/${id}.md`,
    `${pp}/wiki/comparisons/${id}.md`,
    `${pp}/wiki/${id}.md`,
  ]
}
