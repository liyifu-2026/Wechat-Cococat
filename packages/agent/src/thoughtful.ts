import type { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { WeChatClient } from "@cococat/shared";
import { appendAgentTrace } from "./agent-trace.js";
import type { ChatStyle } from "./style.js";
import {
  startDelayedThoughtfulAck,
  type DelayedAckHandle,
} from "./thoughtful-ack.js";

const COMPLEX_HINT =
  /分析|对比|规划|为什么|怎么办|详细|仔细|评估|建议|总结|优缺点/;

export function shouldUseThoughtful(
  style: ChatStyle,
  userLines: string[],
): boolean {
  if (style.replyMode === "thoughtful") return true;
  if (style.replyMode === "fast") return false;
  const text = userLines.join("\n");
  return COMPLEX_HINT.test(text);
}

export function shouldOffloadThoughtfulToOutbound(
  queueEnabled: boolean,
  style: ChatStyle,
  userLines: string[],
): boolean {
  return queueEnabled && shouldUseThoughtful(style, userLines);
}

export function shouldRunThoughtfulReflect(style: ChatStyle): boolean {
  const env = process.env.WECHAT_THOUGHTFUL_REFLECT?.trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;
  if (env === "0" || env === "false" || env === "no") return false;
  return style.thoughtfulReflect === true;
}

export function parseReflectGap(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (/^OK\b/i.test(trimmed)) return undefined;

  const match = trimmed.match(/GAP:\s*(.+)/i);
  if (match?.[1]) return match[1].trim().slice(0, 200);

  if (/不足|缺少|缺|不清楚|需要查|没提到/i.test(trimmed) && trimmed.length < 120) {
    return trimmed.slice(0, 200);
  }

  return undefined;
}

type TextPart = { type: "text"; text: string };

function extractAssistantText(agent: Agent): string | undefined {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (p): p is TextPart =>
            typeof p === "object" &&
            p !== null &&
            (p as TextPart).type === "text",
        )
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

const GATHER_PREFIX = `【内部调研阶段】先查 wiki/翻记录/整理要点，不要发微信。完成后用简短中文列出要点（不超过 200 字），不要 markdown。

`;

const COMPOSE_PREFIX = `【回复阶段】根据下方调研要点回复对方。默认 1 条，自然口语。

【调研要点】
`;

const REFLECT_PREFIX = `【内部自检】不要调用任何工具。只回复一行：
- 若调研要点不足以准确回答对方，回复 GAP:缺什么
- 若足够，回复 OK

【调研要点】
`;

export async function runGatherPhase(
  agent: Agent,
  userPrompt: string,
  images: ImageContent[],
  gatherBlockSendRef: { current: boolean },
): Promise<string | undefined> {
  gatherBlockSendRef.current = true;
  try {
    const gatherPrompt = GATHER_PREFIX + userPrompt;
    if (images.length > 0) {
      await agent.prompt(gatherPrompt, images);
    } else {
      await agent.prompt(gatherPrompt);
    }
    return extractAssistantText(agent);
  } finally {
    gatherBlockSendRef.current = false;
  }
}

export async function runReflectPass(
  agent: Agent,
  gatherNotes: string | undefined,
): Promise<string | undefined> {
  const notes = gatherNotes?.trim() || "（无要点）";
  const reflectPrompt = REFLECT_PREFIX + notes;

  agent.state.messages = [];
  await agent.prompt(reflectPrompt);

  const reply = extractAssistantText(agent);
  return reply ? parseReflectGap(reply) : undefined;
}

export async function runComposePhase(
  agent: Agent,
  userPrompt: string,
  gatherNotes: string | undefined,
  images: ImageContent[],
): Promise<void> {
  const composePrompt =
    COMPOSE_PREFIX +
    (gatherNotes?.trim() || "（无额外要点，直接回复）") +
    "\n\n【对方消息】\n" +
    userPrompt;

  agent.state.messages = [];

  if (images.length > 0) {
    await agent.prompt(composePrompt, images);
  } else {
    await agent.prompt(composePrompt);
  }
}

export type ThoughtfulTurnParams = {
  agent: Agent;
  client: WeChatClient;
  chatId: string;
  chatName?: string;
  turnId?: string;
  style: ChatStyle;
  userPrompt: string;
  images: ImageContent[];
  gatherBlockSendRef: { current: boolean };
  sendCountRef: { current: number };
};

export type ThoughtfulTurnResult = {
  ackLine?: string;
  gatherNotes?: string;
};

/** Gather →（可选 Reflect）→ Compose；15s 无首条 send 则发轮换 ack。 */
export async function runThoughtfulTurn(
  params: ThoughtfulTurnParams,
): Promise<ThoughtfulTurnResult> {
  const traceCtx = {
    chatId: params.chatId,
    chatName: params.chatName,
    turnId: params.turnId,
  };

  const ackLineRef = { current: undefined as string | undefined };
  let delayedAck: DelayedAckHandle | undefined = startDelayedThoughtfulAck({
    client: params.client,
    chatId: params.chatId,
    chatName: params.chatName,
    style: params.style,
    sendCountRef: params.sendCountRef,
    ackLineRef,
  });

  try {
    let gatherNotes = await runGatherPhase(
      params.agent,
      params.userPrompt,
      params.images,
      params.gatherBlockSendRef,
    );
    if (gatherNotes?.trim()) {
      appendAgentTrace({
        ...traceCtx,
        phase: "gather",
        detail: gatherNotes,
      });
    }

    if (shouldRunThoughtfulReflect(params.style)) {
      const gap = await runReflectPass(params.agent, gatherNotes);
      appendAgentTrace({
        ...traceCtx,
        phase: "reflect",
        detail: gap ? `GAP: ${gap}` : "OK",
      });
      if (gap) {
        console.log(`[pi-wechat] thoughtful reflect gap: ${gap.slice(0, 80)}`);
        const supplement =
          params.userPrompt + `\n\n【Reflect 要求补充调研】\n${gap}`;
        params.agent.state.messages = [];
        gatherNotes = await runGatherPhase(
          params.agent,
          supplement,
          params.images,
          params.gatherBlockSendRef,
        );
        if (gatherNotes?.trim()) {
          appendAgentTrace({
            ...traceCtx,
            phase: "gather",
            detail: `[补调研] ${gatherNotes}`,
          });
        }
      }
    }

    await runComposePhase(
      params.agent,
      params.userPrompt,
      gatherNotes,
      params.images,
    );

    return { ackLine: ackLineRef.current, gatherNotes };
  } finally {
    delayedAck?.cancel();
  }
}
