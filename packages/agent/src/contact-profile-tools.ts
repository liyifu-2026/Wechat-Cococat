import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  MAX_PROFILE_TAGS,
  normalizeProfileTags,
  patchContactTags,
} from "./chat-profile.js";

export const PATCH_CONTACT_TAGS_TOOL_NAME = "patch_contact_tags";

export type ContactProfileToolsContext = {
  chatId: string;
};

export function createContactProfileTools(
  ctx: ContactProfileToolsContext,
): AgentTool[] {
  const patchTags: AgentTool = {
    name: PATCH_CONTACT_TAGS_TOOL_NAME,
    label: "更新客户标签",
    description: `根据对话进展更新本会话 profile 标签（最多 ${MAX_PROFILE_TAGS} 个）。每次调用应提交完整标签列表（语义去重、覆盖旧值），不要 append 重复项。禁止修改 userType（客户类型由人类主管在名片上设定，你没有权限读写该字段）。标签应简短、可检索，如「关注退款」「曾问发票」；避免长句和重复含义。`,
    parameters: Type.Object({
      tags: Type.Array(Type.String(), {
        description: `完整标签列表，最多 ${MAX_PROFILE_TAGS} 条，去重后覆盖写入`,
        maxItems: MAX_PROFILE_TAGS,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { tags } = params as { tags: string[] };
      if (!Array.isArray(tags)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "tags 必须是字符串数组。",
            },
          ],
          details: { error: "invalid_tags" },
        };
      }

      const cleaned = normalizeProfileTags(tags);
      const next = await patchContactTags(ctx.chatId, cleaned);

      return {
        content: [
          {
            type: "text" as const,
            text:
              cleaned.length > 0
                ? `已更新标签：${cleaned.join(", ")}`
                : "已清空标签。",
          },
        ],
        details: {
          tags: next.tags,
          userType: next.userType ?? null,
        },
      };
    },
  };

  return [patchTags];
}
