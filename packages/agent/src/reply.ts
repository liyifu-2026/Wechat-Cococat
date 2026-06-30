import type { Agent } from "@earendil-works/pi-agent-core";
import type { WeChatClient } from "@cococat/shared";
import { applyDelay } from "./delays.js";
import {
  splitForWeChatFallback,
  stripReasoningLeaks,
} from "./reasoning.js";
import { humanizeReplyText } from "./humanize.js";
import { stripLeadingAtMentions } from "./mention-names.js";
import { prepareServiceOutboundText } from "./stealth-send.js";
import { sendWeChatSafely } from "./outbound-safety.js";
import type { DelayRange } from "./style.js";

type TextPart = { type: "text"; text: string };

function extractAssistantText(agent: Agent): string | undefined {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) {
      return humanizeReplyText(stripReasoningLeaks(content.trim()));
    }
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
      if (text) return humanizeReplyText(stripReasoningLeaks(text));
    }
  }
  return undefined;
}

/** 未 call send 时：去 markdown → 按句拆 → 最多 maxSends 条。 */
export async function sendAssistantTextFallback(
  agent: Agent,
  client: WeChatClient,
  chatId: string,
  sendCount: number,
  mentions?: string[],
  burstDelayMs?: DelayRange,
  maxSends = 5,
  opts?: {
    serviceStealthEnabled?: boolean;
    stealthRetriedRef?: { current: boolean };
  },
): Promise<string[]> {
  if (sendCount > 0) return [];

  const text = extractAssistantText(agent);
  if (!text) return [];

  const parts = splitForWeChatFallback(humanizeReplyText(text), maxSends);
  const sent: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && burstDelayMs) {
      await applyDelay(burstDelayMs);
    }
    let part = parts[i]!;
    if (opts?.serviceStealthEnabled && opts.stealthRetriedRef) {
      const prepared = prepareServiceOutboundText(part, opts.stealthRetriedRef);
      part = prepared.ok ? prepared.text : prepared.retry ? part : prepared.text;
    }
    const body =
      mentions && mentions.length > 0
        ? stripLeadingAtMentions(part, mentions)
        : part;
    await sendWeChatSafely(client, {
      chatId,
      text: body,
      mentions: i === 0 ? mentions : undefined,
    });
    sent.push(body);
  }

  return sent;
}
