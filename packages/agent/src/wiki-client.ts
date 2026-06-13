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

  async listConsoleProjects(): Promise<ConsoleProjectEntry[]> {
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
      await this.request("GET", "/projects");
      return true;
    } catch {
      return false;
    }
  }

  private async resolveSingleProjectId(): Promise<string> {
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

  async search(query: string, topK: number): Promise<string> {
    const projectIds = await this.projectIdsForSearch();
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
    } catch {
      return null;
    }
  }

  async readPage(fullPath: string): Promise<string> {
    const parsed = parseWikiPagePath(fullPath);
    if (parsed) {
      const projectId =
        this.registry.get(parsed.alias) ?? parsed.alias;
      const r = await this.request(
        "GET",
        `/projects/${projectId}/files/content?path=${urlEncode(parsed.path)}`,
      );
      return String(r.content ?? "(空页面)");
    }

    const projectId = (await this.projectIdsForSearch())[0]!;
    const r = await this.request(
      "GET",
      `/projects/${projectId}/files/content?path=${urlEncode(fullPath)}`,
    );
    return String(r.content ?? "(空页面)");
  }
}
