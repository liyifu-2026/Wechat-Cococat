import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wikiRegistryPath } from "./paths.js";

export type WikiRegistry = Map<string, string>;

export function loadWikiRegistry(): WikiRegistry {
  const map = new Map<string, string>();
  if (!existsSync(wikiRegistryPath())) return map;
  try {
    const raw = JSON.parse(readFileSync(wikiRegistryPath(), "utf8")) as Record<
      string,
      string
    >;
    for (const [alias, projectId] of Object.entries(raw)) {
      if (typeof projectId === "string" && projectId) {
        map.set(alias, projectId);
      }
    }
  } catch (err) {
    console.warn("[pi-wechat] failed to parse wiki-registry.json:", err);
  }
  return map;
}

export function writeWikiRegistry(registry: WikiRegistry): void {
  const obj: Record<string, string> = {};
  for (const [alias, projectId] of registry) {
    obj[alias] = projectId;
  }
  const sorted = Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(
    wikiRegistryPath(),
    `${JSON.stringify(sorted, null, 2)}\n`,
    "utf8",
  );
}

/** `工作/wiki/foo.md` → { alias: "工作", path: "wiki/foo.md" } */
export function parseWikiPagePath(
  fullPath: string,
): { alias: string; path: string } | undefined {
  const slash = fullPath.indexOf("/");
  if (slash <= 0) return undefined;
  return {
    alias: fullPath.slice(0, slash),
    path: fullPath.slice(slash + 1),
  };
}

export function resolveProjectIds(
  aliases: string[],
  registry: WikiRegistry,
): string[] {
  const ids: string[] = [];
  for (const alias of aliases) {
    const id = registry.get(alias) ?? alias;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function captionPath(captionsDir: string, localId: number): string {
  return join(captionsDir, `${localId}.txt`);
}

export function readCaption(captionsDir: string, localId: number): string | undefined {
  const path = captionPath(captionsDir, localId);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  return text || undefined;
}

export function writeCaption(
  captionsDir: string,
  localId: number,
  text: string,
): void {
  writeFileSync(captionPath(captionsDir, localId), text.trim() + "\n", "utf8");
}
