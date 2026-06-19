import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getCococatDataRoot } from "@cococat/shared";
import type { WikiRegistry } from "./wiki-registry.js";

export type WikiScope = {
  version: number;
  indexHash: string;
  purpose: string;
  tags: string[];
  pathHints: string[];
  updatedAt: string;
  source?: string;
};

export type WikiScopeEntry = {
  alias: string;
  scope: WikiScope;
};

const WIKI_SCOPE_DIR = join(getCococatDataRoot(), "wiki-scope");

type CachedScope = {
  scope: WikiScope;
  mtimeMs: number;
};

export function wikiScopeDir(): string {
  mkdirSync(WIKI_SCOPE_DIR, { recursive: true });
  return WIKI_SCOPE_DIR;
}

export function formatWikiScopePrompt(entries: WikiScopeEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = [
    "【当前会话绑定的知识库范围】",
    "你已被接入以下外部知识库。当且仅当用户问题涉及库内的【覆盖核心概念】时，必须调用 wiki_search 检索事实。",
    "",
  ];

  for (const { alias, scope } of entries) {
    lines.push(`### 知识库别名: ${alias}`);
    lines.push(`- 核心定位: ${scope.purpose}`);
    if (scope.tags.length > 0) {
      lines.push(`- 覆盖核心概念: [${scope.tags.join(", ")}]`);
    }
    if (scope.pathHints.length > 0) {
      lines.push(`- 可能包含的页面: ${scope.pathHints.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    "【检索与回复行为准则】",
    "1. 严禁凭聊天记忆或常识盲目猜测上述库中包含的业务事实；涉及这些主题时，先搜再答。",
    "2. 回答时保持自然语气，像自己记得一样说，严禁向用户提及「知识库」「检索结果」「wiki」等术语。",
    "3. 纯日常寒暄、情绪互动、或上文已经明确给出答案的内容，不需要重复检索。",
  );

  return lines.join("\n");
}

function readScopeFile(projectId: string): CachedScope | null {
  const filePath = join(wikiScopeDir(), `${projectId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const stat = statSync(filePath);
    const raw = readFileSync(filePath, "utf8");
    const scope = JSON.parse(raw) as WikiScope;
    if (!scope.purpose || !Array.isArray(scope.tags)) return null;
    return { scope, mtimeMs: stat.mtimeMs };
  } catch (err) {
    console.warn(
      `[pi-wechat] failed to read wiki scope ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export class WikiContextManager {
  private memoryCache = new Map<string, CachedScope>();

  invalidateCache(alias?: string): void {
    if (alias) {
      this.memoryCache.delete(alias);
      return;
    }
    this.memoryCache.clear();
  }

  resolveProjectId(alias: string, registry: WikiRegistry): string {
    return registry.get(alias) ?? alias;
  }

  getScopeFromCache(alias: string, projectId: string): WikiScope | null {
    const filePath = join(wikiScopeDir(), `${projectId}.json`);
    const cached = this.memoryCache.get(alias);
    if (!existsSync(filePath)) {
      this.memoryCache.delete(alias);
      return null;
    }

    try {
      const mtimeMs = statSync(filePath).mtimeMs;
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.scope;
      }
      const loaded = readScopeFile(projectId);
      if (!loaded) return null;
      this.memoryCache.set(alias, loaded);
      return loaded.scope;
    } catch (err) {
      console.warn(
        `[pi-wechat] failed to resolve wiki scope cache for ${alias}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  buildScopePrompt(aliases: string[], registry: WikiRegistry): string {
    if (aliases.length === 0) return "";

    const entries: WikiScopeEntry[] = [];
    for (const alias of aliases) {
      const projectId = this.resolveProjectId(alias, registry);
      const scope = this.getScopeFromCache(alias, projectId);
      if (scope) {
        entries.push({ alias, scope });
      }
    }

    return formatWikiScopePrompt(entries);
  }
}

export const wikiContextManager = new WikiContextManager();

/** Test helper: write a scope snapshot for a project id. */
export function writeWikiScopeSnapshot(
  projectId: string,
  scope: Omit<WikiScope, "indexHash" | "updatedAt"> & {
    indexHash?: string;
    updatedAt?: string;
  },
): void {
  const payload: WikiScope = {
    version: scope.version,
    purpose: scope.purpose,
    tags: scope.tags,
    pathHints: scope.pathHints,
    updatedAt: scope.updatedAt ?? new Date().toISOString(),
    indexHash:
      scope.indexHash ??
      createHash("sha256")
        .update(`${scope.purpose}:${scope.tags.join(",")}`)
        .digest("hex"),
    source: scope.source,
  };
  mkdirSync(wikiScopeDir(), { recursive: true });
  writeFileSync(
    join(wikiScopeDir(), `${projectId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}
