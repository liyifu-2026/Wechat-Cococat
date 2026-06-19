import { readAuthToken } from "@cococat/shared";
import { WikiClient } from "./wiki-client.js";
import { createMemoryClient, type MemoryClient } from "./memory-client.js";
import { MemoryHealthMonitor } from "./memory-health.js";
import { isQueueEnabled } from "./queue/redis.js";
import {
  resolvePollFallbackMs,
  resolveServerUrl,
  resolveProvider,
  resolveModel,
  resolveSystemPrompt,
  resolveHistoryLimit,
  resolveWikiEnabled,
  resolveWikiApiUrl,
  resolveWikiApiToken,
  resolveWikiProjectId,
  resolveGroupConfig,
} from "./effective-config.js";
import type { GroupConfig } from "./group-config.js";

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
  const token = readAuthToken() ?? "";

  if (!token) {
    throw new Error(
      "Missing auth token. Set AGENT_WECHAT_TOKEN or ~/.config/cococat/token",
    );
  }

  const wikiEnabled = resolveWikiEnabled();
  const wikiClient = wikiEnabled
    ? new WikiClient({
        apiUrl: resolveWikiApiUrl(),
        apiToken: resolveWikiApiToken(),
        defaultProjectId: resolveWikiProjectId(),
      })
    : undefined;

  const memoryClient = createMemoryClient();

  return {
    serverUrl: resolveServerUrl(),
    token,
    provider: resolveProvider(),
    model: resolveModel(),
    systemPrompt: resolveSystemPrompt(),
    pollFallbackMs: resolvePollFallbackMs(),
    historyLimit: resolveHistoryLimit(),
    group: resolveGroupConfig(),
    wikiEnabled,
    wikiClient,
    memoryClient,
    memoryHealth: new MemoryHealthMonitor(memoryClient),
    queueEnabled: isQueueEnabled(),
  };
}
