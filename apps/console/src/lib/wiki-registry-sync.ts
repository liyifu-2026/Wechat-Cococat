import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import { loadRegistry } from "@/lib/project-identity"
import { getFileName, normalizePath } from "@/lib/path-utils"

export async function upsertWikiRegistryEntry(
  projectPath: string,
  projectId: string,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const registry = await loadRegistry()
  const entry = Object.values(registry).find((item) => item.path === pp)
  const alias = entry?.name?.trim() || getFileName(pp) || projectId

  let map: Record<string, string> = {}
  try {
    const raw = await readConfigFile("wiki-registry.json")
    if (raw.trim()) {
      map = JSON.parse(raw) as Record<string, string>
    }
  } catch {
    // start fresh
  }

  map[alias] = projectId
  map[projectId] = projectId

  await writeConfigFile(
    "wiki-registry.json",
    `${JSON.stringify(map, null, 2)}\n`,
  )

  return alias
}
