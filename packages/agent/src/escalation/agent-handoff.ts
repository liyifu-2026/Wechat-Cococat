import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EscalationService } from "./service.js";

export const AGENT_HANDOFF_TOOL_NAME = "request_human_handoff";

/** 主 Agent 侧：何时主动升级（不走入口 Gate）。 */
export const AGENT_HANDOFF_PROMPT = `【主动升级同事】
以下情况可调用 request_human_handoff（不要编造答案）：
1. 已用 wiki_search / wiki_read_page 查过，仍无法可靠回答的业务/技术事实；
2. 同一问题已澄清两轮，仍缺少关键信息或超出一线权限（退款审批、账号权限、后台故障等）；
3. 用户情绪尚可，但问题明显需要人工后台处理。

禁止用于：身份试探、纯寒暄、尚未尝试查资料就偷懒升级。
调用后系统会自动发转接话术并 mute 本会话，勿再 wechat_send_message。`;

export type AgentHandoffTurnRef = {
  chatName: string;
  userLines: string[];
  turnId?: string;
  done: boolean;
};

export function createAgentHandoffTools(
  service: EscalationService,
  chatId: string,
  turnRef: AgentHandoffTurnRef,
): AgentTool[] {
  const handoff: AgentTool = {
    name: AGENT_HANDOFF_TOOL_NAME,
    label: "转同事跟进",
    description:
      "一线无法解决且已尽力查资料时，转人工同事跟进；会自动通知客户并结束本会话自动回复。",
    parameters: Type.Object({
      summary: Type.String({
        description: "给维护者看的简短摘要：用户诉求、已尝试、缺什么",
      }),
      reason: Type.Optional(
        Type.String({ description: "升级原因分类，如 technical / policy / unknown" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { summary, reason } = params as {
        summary: string;
        reason?: string;
      };
      const trimmed = summary?.trim();
      if (!trimmed) {
        return {
          content: [
            {
              type: "text" as const,
              text: "summary 不能为空，请简述用户诉求与已做尝试。",
            },
          ],
          details: { error: "empty_summary" },
        };
      }

      await service.applyAgentHandoff({
        chatId,
        chatName: turnRef.chatName || chatId,
        summary: trimmed,
        reason: reason?.trim() || "agent",
        userLines: turnRef.userLines,
        turnId: turnRef.turnId,
      });
      turnRef.done = true;

      return {
        content: [
          {
            type: "text" as const,
            text: "已转同事跟进：已向客户发送转接话术，本会话 auto-reply 已暂停。无需再发微信。",
          },
        ],
        details: { summary: trimmed, reason: reason ?? "agent" },
      };
    },
  };

  return [handoff];
}
