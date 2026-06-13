import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildAgentScopePayload,
  type AgentScopePayload,
  getCococatDataRoot,
} from "@cococat/shared";
import { randomUUID } from "node:crypto";
import { wikiContextManager } from "./wiki-context.js";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function tryReadFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function ensureProjectId(projectPath: string): string {
  const identityPath = join(projectPath, ".llm-wiki", "project.json");
  if (existsSync(identityPath)) {
    try {
      const parsed = JSON.parse(readFileSync(identityPath, "utf8")) as {
        id?: string;
      };
      if (typeof parsed.id === "string" && parsed.id.trim()) {
        return parsed.id.trim();
      }
    } catch {
      // fall through
    }
  }

  const identity = {
    id: randomUUID(),
    createdAt: Date.now(),
  };
  mkdirSync(join(projectPath, ".llm-wiki"), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  return identity.id;
}

export function writeAgentScopeSnapshots(
  projectPath: string,
  projectId: string,
  payload: AgentScopePayload,
): void {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const pp = normalizePath(projectPath);
  const projectScopePath = join(pp, ".llm-wiki", "agent-scope.json");
  const sharedScopePath = join(getCococatDataRoot(), "wiki-scope", `${projectId}.json`);

  mkdirSync(join(pp, ".llm-wiki"), { recursive: true });
  mkdirSync(join(getCococatDataRoot(), "wiki-scope"), { recursive: true });
  writeFileSync(projectScopePath, json, "utf8");
  writeFileSync(sharedScopePath, json, "utf8");
}

export function refreshAgentScopeForProject(
  projectPath: string,
): AgentScopePayload | null {
  const pp = normalizePath(projectPath);
  const wikiIndexPath = join(pp, "wiki", "index.md");
  if (!existsSync(wikiIndexPath)) {
    return null;
  }

  const overview = tryReadFile(join(pp, "wiki", "overview.md"));
  const purposeMd = tryReadFile(join(pp, "purpose.md"));
  const indexContent = tryReadFile(wikiIndexPath);

  if (!indexContent.trim() && !overview.trim() && !purposeMd.trim()) {
    return null;
  }

  const projectId = ensureProjectId(pp);
  const payload = buildAgentScopePayload({
    overview: overview || undefined,
    purposeMd: purposeMd || undefined,
    indexContent,
    source: "cli-refresh",
  });

  writeAgentScopeSnapshots(pp, projectId, payload);
  return payload;
}

type RegistryEntry = {
  id?: string;
  path?: string;
  name?: string;
};

function resolveAppStatePath(): string | null {
  if (process.env.COCOCAT_APP_STATE_PATH?.trim()) {
    return process.env.COCOCAT_APP_STATE_PATH.trim();
  }

  const home = homedir();
  const candidates = [
    join(home, ".local/share/com.cococat.app/app-state.json"),
    join(home, ".local/share/com.llmwiki.app/app-state.json"),
    join(home, "Library/Application Support/com.cococat.app/app-state.json"),
    join(home, "Library/Application Support/com.llmwiki.app/app-state.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function discoverWikiProjectPaths(): string[] {
  const paths = new Set<string>();

  const appStatePath = resolveAppStatePath();
  if (appStatePath) {
    try {
      const raw = JSON.parse(readFileSync(appStatePath, "utf8")) as Record<
        string,
        unknown
      >;
      const registry = raw.projectRegistry;
      if (registry && typeof registry === "object") {
        for (const entry of Object.values(registry as Record<string, RegistryEntry>)) {
          if (entry?.path?.trim()) {
            paths.add(normalizePath(entry.path.trim()));
          }
        }
      }

      const recent = raw.recentProjects;
      if (Array.isArray(recent)) {
        for (const entry of recent) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as RegistryEntry).path === "string"
          ) {
            paths.add(normalizePath((entry as RegistryEntry).path!.trim()));
          }
        }
      }
    } catch (err) {
      console.warn(
        `[wiki-scope-refresh] failed to parse ${appStatePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const root = process.env.COCOCAT_WIKI_PROJECTS_ROOT?.trim();
  if (root && existsSync(root)) {
    for (const name of readdirSafe(root)) {
      const candidate = join(root, name);
      if (isWikiProject(candidate)) {
        paths.add(normalizePath(candidate));
      }
    }
  }

  return [...paths];
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isWikiProject(projectPath: string): boolean {
  return existsSync(join(projectPath, "wiki", "index.md"));
}

export type WikiScopeRefreshResult = {
  projectPath: string;
  projectId: string;
  payload: AgentScopePayload;
};

export type WikiScopeRefreshReport = {
  refreshed: WikiScopeRefreshResult[];
  skipped: string[];
  failed: Array<{ projectPath: string; error: string }>;
};

export function runWikiScopeRefresh(
  projectPaths: string[],
  options?: { invalidateAgentCache?: boolean },
): WikiScopeRefreshReport {
  const report: WikiScopeRefreshReport = {
    refreshed: [],
    skipped: [],
    failed: [],
  };

  const unique = [...new Set(projectPaths.map(normalizePath))];
  for (const projectPath of unique) {
    if (!existsSync(projectPath)) {
      report.failed.push({
        projectPath,
        error: "path does not exist",
      });
      continue;
    }

    if (!isWikiProject(projectPath)) {
      report.skipped.push(projectPath);
      continue;
    }

    try {
      const payload = refreshAgentScopeForProject(projectPath);
      if (!payload) {
        report.skipped.push(projectPath);
        continue;
      }
      const projectId = ensureProjectId(projectPath);
      report.refreshed.push({ projectPath, projectId, payload });
    } catch (err) {
      report.failed.push({
        projectPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (options?.invalidateAgentCache !== false && report.refreshed.length > 0) {
    wikiContextManager.invalidateCache();
  }

  return report;
}

export function printWikiScopeRefreshReport(report: WikiScopeRefreshReport): void {
  for (const item of report.refreshed) {
    console.log(
      `[wiki-scope-refresh] ok ${item.projectId} — ${item.projectPath} (${item.payload.tags.length} tags)`,
    );
  }
  for (const path of report.skipped) {
    console.log(`[wiki-scope-refresh] skip ${path} (no wiki/index.md or empty scope)`);
  }
  for (const item of report.failed) {
    console.error(`[wiki-scope-refresh] fail ${item.projectPath}: ${item.error}`);
  }

  console.log(
    `[wiki-scope-refresh] done: ${report.refreshed.length} refreshed, ${report.skipped.length} skipped, ${report.failed.length} failed`,
  );
}

export async function runWikiScopeRefreshCli(argv: string[]): Promise<number> {
  const allFlag = argv.includes("--all");
  const explicitPaths = argv.filter((arg) => !arg.startsWith("-"));

  let targets = explicitPaths.map(normalizePath);
  if (allFlag) {
    targets = [...targets, ...discoverWikiProjectPaths()];
  }

  if (targets.length === 0) {
    console.error(
      [
        "用法:",
        "  cococat-agent wiki-scope-refresh --all",
        "  cococat-agent wiki-scope-refresh /path/to/wiki-project [...]",
        "",
        "环境变量:",
        "  COCOCAT_APP_STATE_PATH  Console app-state.json 路径",
        "  COCOCAT_WIKI_PROJECTS_ROOT  额外扫描的项目根目录",
        "  COCOCAT_DATA_DIR  共享快照目录（默认 ~/.local/share/cococat）",
      ].join("\n"),
    );
    return 1;
  }

  console.log(`[wiki-scope-refresh] scanning ${targets.length} candidate path(s)...`);
  const report = runWikiScopeRefresh(targets);
  printWikiScopeRefreshReport(report);
  return report.failed.length > 0 ? 1 : 0;
}
