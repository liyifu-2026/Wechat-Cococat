import { loadRegistry } from "@/lib/project-identity"
import {
  loadWikiAliasRegistry,
} from "@/lib/resolve-inbox-chat-wiki"
import { getRecentProjects } from "@/lib/project-store"
import { normalizePath } from "@/lib/path-utils"

export type WikiBindPickerOption = {
  key: string
  alias: string
  projectId: string
  projectPath: string
  name: string
  registered: boolean
}

function resolveEntryPath(
  projectId: string,
  projectRegistry: Awaited<ReturnType<typeof loadRegistry>>,
) {
  const entry =
    projectRegistry[projectId] ??
    Object.values(projectRegistry).find(
      (item) => item.id === projectId || item.name === projectId,
    )
  return entry?.path ? normalizePath(entry.path) : null
}

/** Picker list = wiki-registry aliases ∪ recentProjects (deduped by path). */
export async function loadWikiBindPickerOptions(): Promise<WikiBindPickerOption[]> {
  const [wikiRegistry, projectRegistry, recent] = await Promise.all([
    loadWikiAliasRegistry(),
    loadRegistry(),
    getRecentProjects(),
  ])

  const byPath = new Map<string, WikiBindPickerOption>()

  for (const [alias, projectId] of Object.entries(wikiRegistry)) {
    if (alias === projectId) continue
    const projectPath = resolveEntryPath(projectId, projectRegistry)
    if (!projectPath) continue
    const entry = projectRegistry[projectId]
    byPath.set(projectPath, {
      key: projectPath,
      alias,
      projectId: entry?.id ?? projectId,
      projectPath,
      name: entry?.name?.trim() || alias,
      registered: true,
    })
  }

  for (const project of recent) {
    const projectPath = normalizePath(project.path)
    if (byPath.has(projectPath)) continue
    const aliasFromRegistry = Object.entries(wikiRegistry).find(
      ([, id]) => id === project.id,
    )?.[0]
    byPath.set(projectPath, {
      key: projectPath,
      alias: aliasFromRegistry ?? project.name,
      projectId: project.id,
      projectPath,
      name: project.name,
      registered: Boolean(aliasFromRegistry),
    })
  }

  return [...byPath.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  )
}
