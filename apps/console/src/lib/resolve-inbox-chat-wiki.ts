import { readConfigFile } from "@/lib/agent-config-client"
import {
  loadRegistry,
  type ProjectRegistry,
  type ProjectRegistryEntry,
} from "@/lib/project-identity"
import { normalizePath } from "@/lib/path-utils"

export type InboxChatWikiStatus = "unbound" | "broken" | "partial" | "ok"

export type ResolvedWikiProject = {
  alias: string
  projectId: string
  projectPath: string
  name: string
}

export type ResolveInboxChatWikiResult = {
  status: InboxChatWikiStatus
  aliases: string[]
  resolved: ResolvedWikiProject[]
  invalidAliases: string[]
}

export type WikiAliasRegistry = Record<string, string>

export function parseChatWikiProjects(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as { projects?: unknown }
    if (!Array.isArray(parsed.projects)) return []
    return parsed.projects
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function loadWikiAliasRegistry(): Promise<WikiAliasRegistry> {
  try {
    const raw = await readConfigFile("wiki-registry.json")
    if (!raw.trim()) return {}
    const map = JSON.parse(raw) as Record<string, string>
    return Object.fromEntries(
      Object.entries(map).filter(
        ([, id]) => typeof id === "string" && id.length > 0,
      ),
    )
  } catch {
    return {}
  }
}

function findRegistryEntry(
  alias: string,
  projectId: string,
  registry: ProjectRegistry,
): ProjectRegistryEntry | undefined {
  if (registry[projectId]) return registry[projectId]
  return Object.values(registry).find(
    (entry) => entry.name === alias || entry.id === alias,
  )
}

export function resolveWikiAliasesSync(
  aliases: string[],
  wikiRegistry: WikiAliasRegistry,
  projectRegistry: ProjectRegistry,
): ResolveInboxChatWikiResult {
  if (aliases.length === 0) {
    return {
      status: "unbound",
      aliases: [],
      resolved: [],
      invalidAliases: [],
    }
  }

  const resolved: ResolvedWikiProject[] = []
  const invalidAliases: string[] = []
  const seenPaths = new Set<string>()

  for (const alias of aliases) {
    const projectId = wikiRegistry[alias] ?? alias
    const entry = findRegistryEntry(alias, projectId, projectRegistry)
    const projectPath = entry?.path ? normalizePath(entry.path) : null
    if (!entry || !projectPath || seenPaths.has(projectPath)) {
      invalidAliases.push(alias)
      continue
    }
    seenPaths.add(projectPath)
    resolved.push({
      alias,
      projectId: entry.id,
      projectPath,
      name: entry.name || alias,
    })
  }

  if (resolved.length === 0) {
    return {
      status: "broken",
      aliases,
      resolved: [],
      invalidAliases: aliases,
    }
  }

  return {
    status: invalidAliases.length > 0 ? "partial" : "ok",
    aliases,
    resolved,
    invalidAliases,
  }
}

export async function resolveInboxChatWikiProjects(
  aliases: string[],
): Promise<ResolveInboxChatWikiResult> {
  const [wikiRegistry, projectRegistry] = await Promise.all([
    loadWikiAliasRegistry(),
    loadRegistry(),
  ])
  return resolveWikiAliasesSync(aliases, wikiRegistry, projectRegistry)
}

/** All registered wiki aliases (excludes id→id mirror entries). */
export async function listAllRegisteredWikiAliases(): Promise<string[]> {
  const wikiRegistry = await loadWikiAliasRegistry()
  return Object.entries(wikiRegistry)
    .filter(([alias, id]) => alias !== id)
    .map(([alias]) => alias)
}

/** Resolve every wiki registered in wiki-registry.json. */
export async function resolveAllRegisteredWikiProjects(): Promise<ResolveInboxChatWikiResult> {
  const aliases = await listAllRegisteredWikiAliases()
  return resolveInboxChatWikiProjects(aliases)
}
