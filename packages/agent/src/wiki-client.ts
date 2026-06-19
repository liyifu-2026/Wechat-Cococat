import {
  loadWikiRegistry,
  parseWikiPagePath,
  resolveProjectIds,
  type WikiRegistry,
} from "./wiki-registry.js";
import {
  buildRegistryFromConsoleProjects,
  loadMergedWikiRegistry,
  persistApiRegistry,
  pickDefaultWikiAliases,
  type ConsoleProjectEntry,
} from "./wiki-registry-sync.js";
import {
  isWikiInternalMode,
  wikiListProjectsInternal,
  wikiReadFileInternal,
  wikiSearchFederatedInternal,
} from "./wiki-rpc.js";

export type WikiClientConfig = {
  apiUrl: string;
  apiToken: string;
  defaultProjectId?: string;
};

function urlEncode(s: string): string {
  return encodeURIComponent(s).replace(/%2F/g, "/");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  let end = maxLen;
  while (end > 0 && (text.charCodeAt(end) & 0xfc00) === 0xdc00) {
    end -= 1;
  }
  return `${text.slice(0, end)}...`;
}

type ScoredResult = {
  path: string;
  score: number;
  preview: string;
};

export type WikiProjectMeta = {
  alias: string;
  purpose: string;
  tags: string[];
  pathHints: string[];
  indexHash: string;
  updatedAt: string;
};

export class WikiClient {
  private registry: WikiRegistry;
  private projectAliases: string[] = [];
  private consoleProjects: ConsoleProjectEntry[] = [];

  constructor(private config: WikiClientConfig) {
    this.registry = loadWikiRegistry();
    if (config.defaultProjectId) {
      this.projectAliases = [config.defaultProjectId];
    }
  }

  getRegistry(): WikiRegistry {
    return this.registry;
  }

  private useInternalTransport(): boolean {
    return isWikiInternalMode();
  }

  async listConsoleProjects(): Promise<ConsoleProjectEntry[]> {
    if (this.useInternalTransport()) {
      const rows = await wikiListProjectsInternal();
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        current: p.current,
      }));
    }
    const r = await this.request("GET", "/projects");
    const projects = (r.projects as Array<Record<string, unknown>>) ?? [];
    return projects
      .map((p) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        path: String(p.path ?? ""),
        current: p.current === true,
      }))
      .filter((p) => p.id.length > 0);
  }

  async syncRegistry(): Promise<WikiRegistry> {
    try {
      this.consoleProjects = await this.listConsoleProjects();
      const apiRegistry = buildRegistryFromConsoleProjects(this.consoleProjects);
      this.registry = loadMergedWikiRegistry(apiRegistry);
      persistApiRegistry(apiRegistry);
      return this.registry;
    } catch (err) {
      console.warn(
        "[pi-wechat] wiki registry sync failed, using local file only:",
        err instanceof Error ? err.message : err,
      );
      this.registry = loadWikiRegistry();
      return this.registry;
    }
  }

  pickDefaultAliases(): string[] {
    return pickDefaultWikiAliases(this.consoleProjects);
  }

  setProjectAliases(aliases: string[]): void {
    this.projectAliases = aliases;
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.apiToken) return {};
    return { Authorization: `Bearer ${this.config.apiToken}` };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.apiUrl}/api/v1${path}`;
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    const json = (await resp.json()) as Record<string, unknown>;
    if (json.ok === false) {
      throw new Error(String(json.error ?? "unknown wiki error"));
    }
    return json;
  }

  async checkHealth(): Promise<boolean> {
    try {
      if (this.useInternalTransport()) {
        await wikiListProjectsInternal();
        return true;
      }
      await this.request("GET", "/projects");
      return true;
    } catch (err) {
      console.warn(
        "[pi-wechat] wiki health check failed:",
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  private async resolveSingleProjectId(): Promise<string> {
    if (this.useInternalTransport()) {
      const projects = await this.listConsoleProjects();
      const current = projects.find((p) => p.current);
      const pick = current ?? projects[0];
      if (!pick?.id) throw new Error("No wiki projects found");
      return pick.id;
    }
    const r = await this.request("GET", "/projects");
    const projects = (r.projects as Array<Record<string, unknown>>) ?? [];
    const current = projects.find((p) => p.current === true);
    const pick = current ?? projects[0];
    const id = pick?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("No wiki projects found");
    }
    return id;
  }

  private async projectIdsForSearch(): Promise<string[]> {
    if (this.projectAliases.length > 0) {
      const ids = resolveProjectIds(this.projectAliases, this.registry);
      if (ids.length > 0) return ids;
    }
    if (this.config.defaultProjectId) {
      return [this.config.defaultProjectId];
    }
    return [await this.resolveSingleProjectId()];
  }

  private resolveProjectPath(projectId: string): string {
    const fromConsole = this.consoleProjects.find((p) => p.id === projectId);
    if (fromConsole?.path) return fromConsole.path;
    for (const [, id] of this.registry.entries()) {
      if (id === projectId) {
        const match = this.consoleProjects.find((p) => p.id === projectId);
        if (match?.path) return match.path;
      }
    }
    throw new Error(`No project path for wiki id ${projectId}`);
  }

  private federatedProjectsForSearch(
    projectIds: string[],
  ): Array<{ projectPath: string; projectName?: string }> {
    return projectIds.map((projectId, index) => {
      const alias = this.projectAliases[index] ?? projectId;
      const fromConsole = this.consoleProjects.find((p) => p.id === projectId);
      const projectPath =
        fromConsole?.path ?? this.resolveProjectPath(projectId);
      return {
        projectPath,
        projectName: fromConsole?.name ?? alias,
      };
    });
  }

  async search(query: string, topK: number): Promise<string> {
    const projectIds = await this.projectIdsForSearch();

    if (this.useInternalTransport()) {
      const projects = this.federatedProjectsForSearch(projectIds);
      const hits = await wikiSearchFederatedInternal(
        projects,
        query,
        topK,
        true,
      );
      if (hits.length === 0) {
        return `没找到和「${query}」相关的资料。`;
      }
      return hits
        .slice(0, topK)
        .map((item, i) => {
          const alias =
            item.projectName ??
            this.projectAliases[i] ??
            projectIds[i] ??
            item.projectPath;
          const displayPath = `${alias}/${item.relPath || item.path}`;
          const preview = truncate(String(item.content ?? item.snippet ?? ""), 500);
          return `[${i + 1}] ${displayPath} (score: ${item.rrfScore.toFixed(3)})\n${preview}`;
        })
        .join("\n\n---\n\n");
    }

    const perProject = Math.max(1, Math.ceil(topK / projectIds.length));
    const merged: ScoredResult[] = [];

    for (let i = 0; i < projectIds.length; i++) {
      const projectId = projectIds[i]!;
      const alias = this.projectAliases[i] ?? projectId;
      const r = await this.request("POST", `/projects/${projectId}/search`, {
        query,
        topK: perProject,
        includeContent: true,
      });
      const results = (r.results as Array<Record<string, unknown>>) ?? [];
      for (const item of results) {
        const path = String(item.path ?? "?");
        merged.push({
          path: `${alias}/${path}`,
          score: Number(item.score ?? 0),
          preview: truncate(String(item.content ?? ""), 500),
        });
      }
    }

    if (merged.length === 0) {
      return `没找到和「${query}」相关的资料。`;
    }

    merged.sort((a, b) => b.score - a.score);
    return merged
      .slice(0, topK)
      .map(
        (item, i) =>
          `[${i + 1}] ${item.path} (score: ${item.score.toFixed(3)})\n${item.preview}`,
      )
      .join("\n\n---\n\n");
  }

  async getProjectMeta(alias: string): Promise<WikiProjectMeta | null> {
    if (this.useInternalTransport()) {
      return null;
    }
    const projectId = this.registry.get(alias) ?? alias;
    try {
      const r = await this.request("GET", `/projects/${projectId}/agent-scope`);
      const scope = (r.scope as Record<string, unknown>) ?? {};
      const purpose = String(scope.purpose ?? "").trim();
      if (!purpose) return null;
      return {
        alias,
        purpose,
        tags: Array.isArray(scope.tags)
          ? scope.tags.map((t) => String(t)).filter(Boolean)
          : [],
        pathHints: Array.isArray(scope.pathHints)
          ? scope.pathHints.map((p) => String(p)).filter(Boolean)
          : [],
        indexHash: String(scope.indexHash ?? ""),
        updatedAt: String(scope.updatedAt ?? ""),
      };
    } catch (err) {
      console.warn(
        `[pi-wechat] failed to load wiki project meta for ${alias}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async readPage(fullPath: string): Promise<string> {
    const parsed = parseWikiPagePath(fullPath);
    if (parsed) {
      const projectId = this.registry.get(parsed.alias) ?? parsed.alias;
      if (this.useInternalTransport()) {
        const projectPath = this.resolveProjectPath(projectId);
        return wikiReadFileInternal(projectPath, parsed.path);
      }
      const r = await this.request(
        "GET",
        `/projects/${projectId}/files/content?path=${urlEncode(parsed.path)}`,
      );
      return String(r.content ?? "(空页面)");
    }

    const projectId = (await this.projectIdsForSearch())[0]!;
    if (this.useInternalTransport()) {
      const projectPath = this.resolveProjectPath(projectId);
      return wikiReadFileInternal(projectPath, fullPath);
    }
    const r = await this.request(
      "GET",
      `/projects/${projectId}/files/content?path=${urlEncode(fullPath)}`,
    );
    return String(r.content ?? "(空页面)");
  }
}
