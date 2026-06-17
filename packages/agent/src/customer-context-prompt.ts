import {
  DEFAULT_BEHAVIOR_GUIDE,
  loadChatProfile,
} from "./chat-profile.js";
import {
  findCustomerTypeEntry,
  loadCustomerTypesConfig,
} from "./customer-types/config.js";

/** Per-turn customer type block for system prompt (read fresh each turn). */
export function resolveCustomerContextPrompt(chatId: string): string {
  const profile = loadChatProfile(chatId);
  if (!profile.userType?.trim()) return "";

  const entry = findCustomerTypeEntry(
    profile.userType,
    loadCustomerTypesConfig(),
  );
  const label = entry?.label ?? profile.userType;
  const guide = entry?.behaviorGuide?.trim() || DEFAULT_BEHAVIOR_GUIDE;

  const lines = [
    "## 客户类型与行为准则",
    `- 当前客户类型: ${label} (${profile.userType})`,
    `- 核心行为指南: ${guide}`,
  ];

  if (profile.tags.length > 0) {
    lines.push(`- 已归档标签: ${profile.tags.join(", ")}`);
  }

  return lines.join("\n");
}
