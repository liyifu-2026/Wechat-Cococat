import { existsSync, readFileSync } from "node:fs";
import { resolveConfigPath } from "./paths.js";
import type { GroupConfig, GroupPolicy, ReplyWithMention } from "./group-config.js";

// ── defaults ──────────────────────────────────────────────

export const DEFAULT_POLL_FALLBACK_MS = 30_000;
export const MIN_POLL_FALLBACK_MS = 1_000;
export const DEFAULT_REPLY_COOLDOWN_MS = 30_000;
const DEFAULT_SERVER_URL = "http://localhost:6174";
const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_HISTORY_LIMIT = 40;
const DEFAULT_GROUP_HISTORY_LIMIT = 50;
const DEFAULT_WIKI_API_URL = "http://127.0.0.1:19828";
const DEFAULT_LLM_API_MODEL = "mimo-v2-omni";

// ── helpers ────────────────────────────────────────────────

function parseNonNegativeNumber(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function replyFromEnv(value: string): ReplyWithMention {
  const v = value.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "none") return "none";
  if (v === "all") return "all";
  if (v === "trigger") return "trigger";
  return "trigger";
}

function replyFromJson(value: unknown): ReplyWithMention {
  if (value === false || value === "none") return "none";
  if (value === "all") return "all";
  if (value === "trigger" || value === true) return "trigger";
  return "trigger";
}

// ── poll / cooldown ────────────────────────────────────────

export function resolvePollFallbackMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.WECHAT_PI_POLL_MS ?? DEFAULT_POLL_FALLBACK_MS);
  if (!Number.isFinite(raw)) return DEFAULT_POLL_FALLBACK_MS;
  return Math.max(MIN_POLL_FALLBACK_MS, raw);
}

export function resolveReplyCooldownMs(params: {
  styleCooldownMs?: number;
  env?: NodeJS.ProcessEnv;
}): number {
  if (
    params.styleCooldownMs !== undefined &&
    Number.isFinite(params.styleCooldownMs) &&
    params.styleCooldownMs >= 0
  ) {
    return params.styleCooldownMs;
  }
  return (
    parseNonNegativeNumber(
      (params.env ?? process.env).WECHAT_REPLY_COOLDOWN_MS,
    ) ?? DEFAULT_REPLY_COOLDOWN_MS
  );
}

// ── server / provider / model ──────────────────────────────

export function resolveServerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.AGENT_WECHAT_URL ?? env.WECHAT_SERVER_URL ?? DEFAULT_SERVER_URL;
}

export function resolveProvider(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.PI_PROVIDER ?? env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
}

export function resolveModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.PI_MODEL ?? env.LLM_MODEL ?? DEFAULT_MODEL;
}

export function resolveSystemPrompt(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.WECHAT_PI_SYSTEM_PROMPT;
}

export function resolveHistoryLimit(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInt(env.WECHAT_PI_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT);
}

// ── wiki ───────────────────────────────────────────────────

export function resolveWikiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.WIKI_ENABLED === "true" || env.WIKI_ENABLED === "1";
}

export function resolveWikiApiUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.WIKI_API_URL ?? DEFAULT_WIKI_API_URL).replace(/\/$/, "");
}

export function resolveWikiApiToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.WIKI_API_TOKEN ?? "";
}

export function resolveWikiProjectId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.WIKI_PROJECT_ID?.trim() || undefined;
}

// ── burst delay ────────────────────────────────────────────

export function resolveBurstDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.WECHAT_PI_BURST_DELAY_MS;
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// ── group config ───────────────────────────────────────────

type GroupsFileEntry = {
  require_mention?: boolean;
  reply_with_mention?: unknown;
};

function entryToPolicy(entry: GroupsFileEntry): GroupPolicy {
  return {
    requireMention: entry.require_mention ?? true,
    replyWithMention: entry.reply_with_mention
      ? replyFromJson(entry.reply_with_mention)
      : "none",
  };
}

function loadGroupsFile(path: string): {
  overrides: Map<string, GroupPolicy>;
  wildcard?: GroupsFileEntry;
} {
  const overrides = new Map<string, GroupPolicy>();
  if (!existsSync(path)) return { overrides };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      GroupsFileEntry
    >;
    let wildcard: GroupsFileEntry | undefined;
    for (const [key, entry] of Object.entries(raw)) {
      if (key === "*") {
        wildcard = entry;
      } else {
        overrides.set(key, entryToPolicy(entry));
      }
    }
    return { overrides, wildcard };
  } catch (err) {
    console.warn(`[pi-wechat] failed to parse groups config ${path}:`, err);
    return { overrides };
  }
}

export function resolveGroupConfig(
  env: NodeJS.ProcessEnv = process.env,
): GroupConfig {
  const defaultPolicy: GroupPolicy = {
    requireMention: env.BRIDGE_REQUIRE_MENTION
      ? env.BRIDGE_REQUIRE_MENTION !== "false" &&
        env.BRIDGE_REQUIRE_MENTION !== "0"
      : true,
    replyWithMention: env.BRIDGE_REPLY_WITH_MENTION
      ? replyFromEnv(env.BRIDGE_REPLY_WITH_MENTION)
      : "none",
  };

  const groupsConfigPath =
    env.BRIDGE_GROUPS_CONFIG ?? resolveConfigPath("bridge-groups.json");

  const groupHistoryLimit = parsePositiveInt(
    env.BRIDGE_GROUP_HISTORY_LIMIT,
    DEFAULT_GROUP_HISTORY_LIMIT,
  );

  const { overrides, wildcard } = loadGroupsFile(groupsConfigPath);
  if (wildcard) {
    if (wildcard.require_mention !== undefined) {
      defaultPolicy.requireMention = wildcard.require_mention;
    }
    if (wildcard.reply_with_mention !== undefined) {
      defaultPolicy.replyWithMention = replyFromJson(
        wildcard.reply_with_mention,
      );
    }
  }

  return {
    defaultPolicy,
    groupOverrides: overrides,
    groupsConfigPath,
    groupHistoryLimit,
  };
}

// ── LLM API config (shared fallback chain for caption / triage) ──

export type LlmApiConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

function resolveLlmApiConfig(
  env: NodeJS.ProcessEnv,
  opts: {
    enabledKey: string;
    apiKeyKey: string;
    apiUrlKey: string;
    modelKey: string;
  },
): LlmApiConfig | undefined {
  if (env[opts.enabledKey] === "false") return undefined;

  const apiKey =
    env[opts.apiKeyKey]?.trim() ||
    env.TDAI_LLM_API_KEY?.trim() ||
    env.XIAOMI_TOKEN_PLAN_CN_API_KEY?.trim();
  if (!apiKey) return undefined;

  const apiUrl = (
    env[opts.apiUrlKey]?.trim() ||
    env.TDAI_LLM_BASE_URL?.trim() ||
    env.XIAOMI_API_BASE?.trim() ||
    "https://token-plan-cn.xiaomimimo.com/v1"
  ).replace(/\/$/, "");

  const model =
    env[opts.modelKey]?.trim() ||
    env.TDAI_LLM_MODEL?.trim() ||
    env.PI_MODEL?.trim() ||
    DEFAULT_LLM_API_MODEL;

  return { apiUrl, apiKey, model };
}

export function resolveCaptionLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmApiConfig | undefined {
  return resolveLlmApiConfig(env, {
    enabledKey: "WECHAT_CAPTION_ENABLED",
    apiKeyKey: "WECHAT_CAPTION_API_KEY",
    apiUrlKey: "WECHAT_CAPTION_API_URL",
    modelKey: "WECHAT_CAPTION_MODEL",
  });
}

export function resolveTriageLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmApiConfig | undefined {
  return resolveLlmApiConfig(env, {
    enabledKey: "WECHAT_TRIAGE_LLM_ENABLED",
    apiKeyKey: "WECHAT_TRIAGE_API_KEY",
    apiUrlKey: "WECHAT_TRIAGE_API_URL",
    modelKey: "WECHAT_TRIAGE_MODEL",
  });
}

// ── thoughtful config ──────────────────────────────────────

export function resolveThoughtfulAckPhrases(
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const raw = env.WECHAT_THOUGHTFUL_ACK_PHRASES?.trim();
  if (!raw) return undefined;
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/** Resolve WECHAT_THOUGHTFUL_ACK flag. undefined = not set in env. */
export function resolveThoughtfulAckFlag(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const raw = env.WECHAT_THOUGHTFUL_ACK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true") return true;
  if (raw) return true;
  return undefined;
}

export function resolveThoughtfulAckDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.WECHAT_THOUGHTFUL_ACK_DELAY_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 15_000;
}

export function resolveThoughtfulReflect(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const raw = env.WECHAT_THOUGHTFUL_REFLECT?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

// ── escalation gate ────────────────────────────────────────

export function resolveUnifiedGateLlm(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const raw = env.WECHAT_UNIFIED_GATE_LLM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return undefined;
}
