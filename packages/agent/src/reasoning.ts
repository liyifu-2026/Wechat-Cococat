import type { Agent } from "@earendil-works/pi-agent-core";

/** 去掉 MiMo reasoning / markdown 痕迹，避免泄漏到微信。 */
export function stripReasoningLeaks(text: string): string {
  let out = text;
  out = out.replace(/[\s\S]*?<\/think>/gi, "");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/`{1,3}([^`]+)`{1,3}/g, "$1");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  return out.trim();
}

/** 从 agent 最后一条 assistant 消息中剥离 thinking / reasoning。 */
export function stripReasoningFromAgent(agent: Agent): void {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as {
      role?: string;
      content?: unknown;
    };
    if (msg.role !== "assistant") continue;

    const content = msg.content;
    if (typeof content === "string") {
      (messages[i] as { content: string }).content = stripReasoningLeaks(content);
      return;
    }
    if (Array.isArray(content)) {
      const next = content
        .filter(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            (p as { type?: string }).type !== "thinking",
        )
        .map((p) => {
          if (
            typeof p === "object" &&
            p !== null &&
            (p as { type?: string }).type === "text" &&
            typeof (p as { text?: string }).text === "string"
          ) {
            return {
              ...p,
              text: stripReasoningLeaks((p as { text: string }).text),
            };
          }
          return p;
        });
      (messages[i] as { content: unknown }).content = next;
      return;
    }
    return;
  }
}

const SENTENCE_SPLIT = /(?<=[。！？；\n])/;

/** 去 markdown 后按句拆，最多 max 条。 */
export function splitForWeChatFallback(
  text: string,
  max = 5,
): string[] {
  const cleaned = stripReasoningLeaks(text);
  if (!cleaned) return [];

  const parts = cleaned
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return [cleaned.slice(0, 500)];
  if (parts.length <= max) return parts;

  const head = parts.slice(0, max - 1);
  const tail = parts.slice(max - 1).join("");
  return [...head, tail.trim()].filter(Boolean);
}
