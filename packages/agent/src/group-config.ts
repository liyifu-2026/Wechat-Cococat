import { existsSync, readFileSync } from "node:fs";
import { resolveConfigPath } from "./paths.js";

export type ReplyWithMention = "trigger" | "all" | "none";

export type GroupPolicy = {
  requireMention: boolean;
  replyWithMention: ReplyWithMention;
};

export type GroupConfig = {
  defaultPolicy: GroupPolicy;
  groupOverrides: Map<string, GroupPolicy>;
  groupsConfigPath: string;
  groupHistoryLimit: number;
};

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
  if (!existsSync(path)) {
    return { overrides };
  }
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

export function loadGroupConfig(): GroupConfig {
  const defaultPolicy: GroupPolicy = {
    requireMention: process.env.BRIDGE_REQUIRE_MENTION
      ? process.env.BRIDGE_REQUIRE_MENTION !== "false" &&
        process.env.BRIDGE_REQUIRE_MENTION !== "0"
      : true,
    replyWithMention: process.env.BRIDGE_REPLY_WITH_MENTION
      ? replyFromEnv(process.env.BRIDGE_REPLY_WITH_MENTION)
      : "none",
  };

  const groupsConfigPath =
    process.env.BRIDGE_GROUPS_CONFIG ??
    resolveConfigPath("bridge-groups.json");

  const groupHistoryLimit = Number(
    process.env.BRIDGE_GROUP_HISTORY_LIMIT ?? "50",
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

export function policyFor(config: GroupConfig, chatId: string): GroupPolicy {
  return config.groupOverrides.get(chatId) ?? config.defaultPolicy;
}
