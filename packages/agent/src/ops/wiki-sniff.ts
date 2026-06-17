import type { WikiClient } from "../wiki-client.js";
import {
  wikiContextManager,
  type WikiScope,
} from "../wiki-context.js";

export const OPS_MAX_REPLY_CHARS = 3500;
export const OPS_SEARCH_TOP_K = 5;
export const OPS_READ_MAX_CHARS = 2400;

export type MaintainerWikiCommand =
  | { type: "scope" }
  | { type: "search"; query: string }
  | { type: "read"; path: string };

export function parseMaintainerWikiCommand(
  body: string,
): MaintainerWikiCommand | null {
  const text = body.trim();
  if (!text) return null;
  if (/^scope$/iu.test(text)) return { type: "scope" };
  const search = text.match(/^搜\s+(.+)$/su);
  if (search?.[1]?.trim()) return { type: "search", query: search[1].trim() };
  const read = text.match(/^读\s+(.+)$/su);
  if (read?.[1]?.trim()) return { type: "read", path: read[1].trim() };
  return null;
}

export function clampOpsReply(text: string): string {
  if (text.length <= OPS_MAX_REPLY_CHARS) return text;
  return `${text.slice(0, OPS_MAX_REPLY_CHARS - 20)}\n\n(已截断)`;
}

export async function resolveMaintainerWikiAliases(
  wikiClient: WikiClient,
): Promise<string[]> {
  await wikiClient.syncRegistry();
  const defaults = wikiClient.pickDefaultAliases();
  if (defaults.length > 0) return defaults;

  const registry = wikiClient.getRegistry();
  const named: string[] = [];
  for (const [alias, id] of registry) {
    if (alias !== id) named.push(alias);
  }
  if (named.length > 0) return named;

  return [...new Set(registry.values())];
}

function formatScopeEntry(alias: string, scope: WikiScope | null, projectId: string): string {
  const lines: string[] = [`· ${alias} (${projectId.slice(0, 8)}…)`];
  if (!scope) {
    lines.push("  无 agent-scope 快照 — 请 Ingest 或 cococat-agent wiki-scope-refresh");
    return lines.join("\n");
  }
  lines.push(`  定位：${scope.purpose}`);
  if (scope.tags.length > 0) {
    lines.push(`  标签：${scope.tags.join(", ")}`);
  }
  if (scope.pathHints.length > 0) {
    lines.push(`  路径提示：${scope.pathHints.slice(0, 8).join(", ")}`);
  }
  lines.push(`  indexHash：${scope.indexHash.slice(0, 12)}…`);
  return lines.join("\n");
}

export function formatOpsScopeReply(
  rows: Array<{ alias: string; scope: WikiScope | null; projectId: string }>,
): string {
  if (rows.length === 0) {
    return [
      "【Wiki Scope】",
      "未发现已注册 Wiki 项目。",
      "请确认 Console 已打开项目且 WIKI_API_URL 可达。",
    ].join("\n");
  }
  const blocks = rows.map(({ alias, scope, projectId }) =>
    formatScopeEntry(alias, scope, projectId),
  );
  return ["【Wiki Scope】", ...blocks].join("\n\n");
}

export async function buildOpsScopeEntries(
  wikiClient: WikiClient,
): Promise<Array<{ alias: string; scope: WikiScope | null; projectId: string }>> {
  const aliases = await resolveMaintainerWikiAliases(wikiClient);
  const registry = wikiClient.getRegistry();
  return aliases.map((alias) => {
    const projectId = registry.get(alias) ?? alias;
    const scope = wikiContextManager.getScopeFromCache(alias, projectId);
    return { alias, scope, projectId };
  });
}

export async function formatOpsScopeFromClient(
  wikiClient: WikiClient,
): Promise<string> {
  const rows = await buildOpsScopeEntries(wikiClient);
  return clampOpsReply(formatOpsScopeReply(rows));
}

export async function formatOpsSearchReply(
  wikiClient: WikiClient,
  query: string,
): Promise<string> {
  const aliases = await resolveMaintainerWikiAliases(wikiClient);
  wikiClient.setProjectAliases(aliases);
  let body: string;
  try {
    body = await wikiClient.search(query, OPS_SEARCH_TOP_K);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return clampOpsReply(`【搜：${query}】\nWiki 检索失败：${msg}`);
  }
  const header = `【搜：${query}】top ${OPS_SEARCH_TOP_K}`;
  if (body.includes("没找到")) {
    return clampOpsReply(`${header}\n0 条命中。`);
  }
  return clampOpsReply(`${header}\n${body}`);
}

export async function formatOpsReadReply(
  wikiClient: WikiClient,
  path: string,
): Promise<string> {
  await wikiClient.syncRegistry();
  const aliases = await resolveMaintainerWikiAliases(wikiClient);
  wikiClient.setProjectAliases(aliases);
  let content: string;
  try {
    content = await wikiClient.readPage(path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return clampOpsReply(`【读：${path}】\n失败：${msg}`);
  }
  const clipped =
    content.length > OPS_READ_MAX_CHARS
      ? `${content.slice(0, OPS_READ_MAX_CHARS)}\n\n(正文已截断)`
      : content;
  return clampOpsReply(`【读：${path}】\n${clipped}`);
}

/** 命中 Wiki Ops 指令时返回回复正文；未命中返回 null。 */
export async function tryMaintainerWikiOpsReply(
  body: string,
  wikiClient: WikiClient | undefined,
  wikiEnabled: boolean,
): Promise<string | null> {
  const cmd = parseMaintainerWikiCommand(body);
  if (!cmd) return null;

  if (!wikiEnabled || !wikiClient) {
    return "Wiki 嗅探未启用。请设置 WIKI_ENABLED=1 并确保 Console API 可达。";
  }

  switch (cmd.type) {
    case "scope":
      return formatOpsScopeFromClient(wikiClient);
    case "search":
      return formatOpsSearchReply(wikiClient, cmd.query);
    case "read":
      return formatOpsReadReply(wikiClient, cmd.path);
    default:
      return null;
  }
}

export function maintainerOpsHelpExtra(wikiEnabled: boolean): string {
  if (!wikiEnabled) return "";
  return " / scope / 搜 <词> / 读 <路径>";
}
