import type { Agent, AgentTool } from "@earendil-works/pi-agent-core";
import { appendConsoleEvent } from "./console-events.js";
import { stripReasoningLeaks } from "./reasoning.js";

export type AgentTracePhase =
  | "inbound"
  | "buffer"
  | "triage"
  | "memory"
  | "queue"
  | "thinking"
  | "gather"
  | "reflect"
  | "ack"
  | "compose"
  | "assistant"
  | "skip"
  | "discard"
  | "tool_in"
  | "tool_out"
  | "reply";

const MAX_DETAIL = 8_000;
const MAX_QUERY = 2_000;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function safeJson(value: unknown): string {
  try {
    return truncate(JSON.stringify(value), MAX_QUERY);
  } catch (err) {
    console.warn(
      "[pi-wechat] failed to serialize trace payload:",
      err instanceof Error ? err.message : err,
    );
    return truncate(String(value), MAX_QUERY);
  }
}

type TextPart = { type: "text"; text: string };
type ThinkingPart = { type: "thinking"; thinking?: string; text?: string };

export function createTurnId(chatId: string, localIds: number[]): string {
  const tail = localIds.length > 0 ? localIds.join(",") : String(Date.now());
  return `${chatId}:${tail}`;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) {
    return stripReasoningLeaks(content.trim());
  }
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(
      (p): p is TextPart =>
        typeof p === "object" &&
        p !== null &&
        (p as TextPart).type === "text" &&
        typeof (p as TextPart).text === "string",
    )
    .map((p) => p.text)
    .join("")
    .trim();
  return text ? stripReasoningLeaks(text) : undefined;
}

/** 收集本轮 agent 消息里所有 thinking 块。 */
export function extractAllThinking(agent: Agent): string | undefined {
  const parts: string[] = [];
  for (const raw of agent.state.messages) {
    const msg = raw as { role?: string; content?: unknown };
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") {
      const leaked = content.match(/[\s\S]*?<\/think>/i);
      if (leaked?.[0]) parts.push(stripReasoningLeaks(leaked[0]));
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const p of content) {
      if (typeof p !== "object" || p === null) continue;
      const part = p as ThinkingPart;
      if (part.type === "thinking") {
        const t = part.thinking ?? part.text;
        if (typeof t === "string" && t.trim()) parts.push(t.trim());
      }
    }
  }
  if (parts.length === 0) return undefined;
  return truncate(parts.join("\n---\n"), MAX_DETAIL);
}

/** 最后一条 assistant 成稿（thinking strip 前）。 */
export function extractAssistantDraft(agent: Agent): string | undefined {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "assistant") continue;
    const text = extractTextFromContent(msg.content);
    if (text) return truncate(text, MAX_DETAIL);
  }
  return undefined;
}

/** @deprecated 使用 extractAllThinking */
export function extractThinkingSnippet(agent: Agent): string | undefined {
  return extractAllThinking(agent);
}

export function appendAgentTrace(params: {
  chatId?: string;
  chatName?: string;
  turnId?: string;
  phase: AgentTracePhase;
  detail: string;
  query?: string;
  confidence?: number;
}): void {
  const detail = truncate(stripReasoningLeaks(params.detail), MAX_DETAIL);
  if (!detail) return;

  appendConsoleEvent({
    kind: "agent_trace",
    chatId: params.chatId,
    chatName: params.chatName,
    turnId: params.turnId,
    topic: params.phase,
    query: params.query ? truncate(params.query, MAX_QUERY) : undefined,
    confidence: params.confidence,
    reason: detail,
  });
}

export type ToolTraceContext = {
  chatId: string;
  chatName?: string;
  getTurnId: () => string | undefined;
};

function toolResultPreview(result: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  const text = (result.content ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n");
  return truncate(text || "(无文本结果)", MAX_DETAIL);
}

/** 为工具调用写入 tool_in / tool_out 轨迹。 */
export function wrapToolsWithTrace(
  tools: AgentTool[],
  ctx: ToolTraceContext,
): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args) => {
      const params = args[1];
      appendAgentTrace({
        chatId: ctx.chatId,
        chatName: ctx.chatName,
        turnId: ctx.getTurnId(),
        phase: "tool_in",
        query: tool.name,
        detail: safeJson(params),
      });
      const result = await tool.execute(...args);
      appendAgentTrace({
        chatId: ctx.chatId,
        chatName: ctx.chatName,
        turnId: ctx.getTurnId(),
        phase: "tool_out",
        query: tool.name,
        detail: toolResultPreview(result),
      });
      return result;
    },
  }));
}
