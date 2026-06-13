import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getOutboundQueue } from "./queue/queues.js";
import { isOutboundChatAllowed, isQuietHoursNow } from "./schedules/quiet-hours.js";
import { loadSchedulesFile } from "./schedules/registry.js";

export type ScheduleToolContext = {
  chatId: string;
};

export function createScheduleTools(ctx: ScheduleToolContext): AgentTool[] {
  const scheduleMessage: AgentTool = {
    name: "schedule_message",
    label: "延迟发消息",
    description:
      "在指定秒数后向当前聊天发送一条文字（主动消息）。用户要求「X 分钟后提醒」时使用。",
    parameters: Type.Object({
      text: Type.String({ description: "到时发送的文字" }),
      delaySeconds: Type.Number({
        description: "延迟秒数，最少 10",
        minimum: 10,
      }),
    }),
    execute: async (_id, params) => {
      const { text, delaySeconds } = params as {
        text: string;
        delaySeconds: number;
      };
      const schedules = loadSchedulesFile();
      if (!isOutboundChatAllowed(ctx.chatId, schedules.allowlistChatIds)) {
        return {
          content: [
            { type: "text" as const, text: "该聊天未在主动消息 allowlist 中。" },
          ],
          details: {},
        };
      }
      if (isQuietHoursNow(schedules.quietHours)) {
        return {
          content: [
            { type: "text" as const, text: "当前处于静默时段，无法排期。" },
          ],
          details: {},
        };
      }

      const queue = getOutboundQueue();
      const job = await queue.add(
        "send_text",
        {
          chatId: ctx.chatId,
          kind: "send_text",
          text,
        },
        { delay: Math.max(10, delaySeconds) * 1000 },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `已排期 ${delaySeconds}s 后发送（job ${job.id}）`,
          },
        ],
        details: { jobId: job.id },
      };
    },
  };

  const scheduleAgentTurn: AgentTool = {
    name: "schedule_agent_turn",
    label: "延迟 Agent 任务",
    description:
      "在指定秒数后触发一轮主动 Agent 思考并可能发消息。用于复杂延迟任务。",
    parameters: Type.Object({
      prompt: Type.String({ description: "到时执行的系统任务说明" }),
      delaySeconds: Type.Number({ minimum: 10 }),
      thoughtful: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) => {
      const { prompt, delaySeconds, thoughtful } = params as {
        prompt: string;
        delaySeconds: number;
        thoughtful?: boolean;
      };
      const schedules = loadSchedulesFile();
      if (!isOutboundChatAllowed(ctx.chatId, schedules.allowlistChatIds)) {
        return {
          content: [{ type: "text" as const, text: "未在 allowlist。" }],
          details: {},
        };
      }

      const queue = getOutboundQueue();
      const job = await queue.add(
        "run_agent_turn",
        {
          chatId: ctx.chatId,
          kind: thoughtful ? "thoughtful_turn" : "run_agent_turn",
          systemPrompt: prompt,
        },
        { delay: Math.max(10, delaySeconds) * 1000 },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `已排期 agent 任务 ${delaySeconds}s 后（job ${job.id}）`,
          },
        ],
        details: { jobId: job.id },
      };
    },
  };

  return [scheduleMessage, scheduleAgentTurn];
}
