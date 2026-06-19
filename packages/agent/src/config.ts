import { readAuthToken } from "@cococat/shared";
import { loadGroupConfig, type GroupConfig } from "./group-config.js";
import { WikiClient } from "./wiki-client.js";
import { createMemoryClient, type MemoryClient } from "./memory-client.js";
import { MemoryHealthMonitor } from "./memory-health.js";
import { isQueueEnabled } from "./queue/redis.js";
import { resolvePollFallbackMs } from "./effective-config.js";

export type PiWeChatConfig = {
  serverUrl: string;
  token: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  pollFallbackMs: number;
  historyLimit: number;
  group: GroupConfig;
  wikiEnabled: boolean;
  wikiClient?: WikiClient;
  memoryClient: MemoryClient;
  memoryHealth: MemoryHealthMonitor;
  queueEnabled: boolean;
};

export function loadConfig(): PiWeChatConfig {
  const serverUrl =
    process.env.AGENT_WECHAT_URL ??
    process.env.WECHAT_SERVER_URL ??
    "http://localhost:6174";
  const token = readAuthToken() ?? "";

  if (!token) {
    throw new Error(
      "Missing auth token. Set AGENT_WECHAT_TOKEN or ~/.config/cococat/token",
    );
  }

  const group = loadGroupConfig();
  const wikiEnabled =
    process.env.WIKI_ENABLED === "true" || process.env.WIKI_ENABLED === "1";
  const wikiApiUrl = process.env.WIKI_API_URL ?? "http://127.0.0.1:19828";
  const wikiApiToken = process.env.WIKI_API_TOKEN ?? "";
  const wikiDefaultProject = process.env.WIKI_PROJECT_ID?.trim();

  let wikiClient: WikiClient | undefined;
  if (wikiEnabled) {
    wikiClient = new WikiClient({
      apiUrl: wikiApiUrl.replace(/\/$/, ""),
      apiToken: wikiApiToken,
      defaultProjectId: wikiDefaultProject,
    });
  }

  const memoryClient = createMemoryClient();

  return {
    serverUrl,
    token,
    provider: process.env.PI_PROVIDER ?? process.env.LLM_PROVIDER ?? "anthropic",
    model:
      process.env.PI_MODEL ??
      process.env.LLM_MODEL ??
      "claude-sonnet-4-20250514",
    systemPrompt: process.env.WECHAT_PI_SYSTEM_PROMPT,
    pollFallbackMs: resolvePollFallbackMs(),
    historyLimit: Number(process.env.WECHAT_PI_HISTORY_LIMIT ?? "40"),
    group,
    wikiEnabled,
    wikiClient,
    memoryClient,
    memoryHealth: new MemoryHealthMonitor(memoryClient),
    queueEnabled: isQueueEnabled(),
  };
}
