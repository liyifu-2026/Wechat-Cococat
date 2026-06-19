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

export function policyFor(config: GroupConfig, chatId: string): GroupPolicy {
  return config.groupOverrides.get(chatId) ?? config.defaultPolicy;
}
