import type { WikiRegistry } from "./wiki-registry.js";
import { loadWikiRegistry, writeWikiRegistry } from "./wiki-registry.js";

export type ConsoleProjectEntry = {
  id: string;
  name: string;
  path: string;
  current?: boolean;
};

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function buildRegistryFromConsoleProjects(
  projects: ConsoleProjectEntry[],
): WikiRegistry {
  const map = new Map<string, string>();

  for (const project of projects) {
    const id = project.id?.trim();
    if (!id) continue;

    map.set(id, id);

    const name = project.name?.trim();
    if (name) map.set(name, id);

    const folder = basename(project.path);
    if (folder && folder !== name) {
      map.set(folder, id);
    }
  }

  return map;
}

/** 文件里的条目优先（用户可手动覆盖），API 补全缺失项。 */
export function mergeWikiRegistries(
  fileRegistry: WikiRegistry,
  apiRegistry: WikiRegistry,
): WikiRegistry {
  const merged = new Map<string, string>();
  for (const [alias, id] of apiRegistry) {
    merged.set(alias, id);
  }
  for (const [alias, id] of fileRegistry) {
    merged.set(alias, id);
  }
  return merged;
}

export function pickDefaultWikiAliases(
  projects: ConsoleProjectEntry[],
): string[] {
  if (projects.length === 0) return [];

  const current = projects.find((p) => p.current === true);
  if (current?.name?.trim()) return [current.name.trim()];
  if (current?.id) return [current.id];

  if (projects.length === 1) {
    const only = projects[0]!;
    return [only.name?.trim() || only.id];
  }

  const names = projects
    .map((p) => p.name?.trim())
    .filter((name): name is string => Boolean(name));
  if (names.length > 0) return names;

  return projects.map((p) => p.id);
}

export function loadMergedWikiRegistry(
  apiRegistry: WikiRegistry,
): WikiRegistry {
  return mergeWikiRegistries(loadWikiRegistry(), apiRegistry);
}

export function persistApiRegistry(apiRegistry: WikiRegistry): void {
  if (apiRegistry.size === 0) return;
  const merged = mergeWikiRegistries(loadWikiRegistry(), apiRegistry);
  writeWikiRegistry(merged);
}
