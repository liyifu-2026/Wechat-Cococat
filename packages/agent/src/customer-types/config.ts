import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCococatConfigDir } from "@cococat/shared";

export type CustomerTypeEntry = {
  id: string;
  label: string;
  description?: string;
  wikiProjects?: string[];
  behaviorGuide?: string;
  sortOrder?: number;
};

export type CustomerTypesConfig = {
  types: CustomerTypeEntry[];
};

let configCache: { hash: string; config: CustomerTypesConfig } | undefined;

function hashFile(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function customerTypesConfigPath(): string {
  return join(getCococatConfigDir(), "customer-types.json");
}

export function clearCustomerTypesConfigCache(): void {
  configCache = undefined;
}

function parseConfig(raw: Record<string, unknown>): CustomerTypesConfig {
  const typesRaw = raw.types;
  if (!Array.isArray(typesRaw)) return { types: [] };
  const types: CustomerTypeEntry[] = [];
  for (const item of typesRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!id || !label) continue;
    types.push({
      id,
      label,
      description:
        typeof row.description === "string" ? row.description.trim() : "",
      wikiProjects: Array.isArray(row.wikiProjects)
        ? row.wikiProjects
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      behaviorGuide:
        typeof row.behaviorGuide === "string"
          ? row.behaviorGuide.trim()
          : "",
      sortOrder:
        typeof row.sortOrder === "number" ? row.sortOrder : types.length,
    });
  }
  types.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { types };
}

export function loadCustomerTypesConfig(): CustomerTypesConfig {
  const path = customerTypesConfigPath();
  if (!existsSync(path)) return { types: [] };
  const raw = readFileSync(path, "utf8");
  const hash = hashFile(raw);
  if (configCache && configCache.hash === hash) {
    return configCache.config;
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const config = parseConfig(parsed);
  configCache = { hash, config };
  return config;
}

export function findCustomerTypeEntry(
  userType: string,
  config?: CustomerTypesConfig,
): CustomerTypeEntry | undefined {
  const id = userType.trim();
  if (!id) return undefined;
  const cfg = config ?? loadCustomerTypesConfig();
  return cfg.types.find((t) => t.id === id);
}
