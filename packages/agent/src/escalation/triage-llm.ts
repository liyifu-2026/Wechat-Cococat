import type { ChatEscalationState, GateAction } from "./types.js";
import { formatTranscriptForGate } from "../transcript-context.js";
import type { TranscriptEntry } from "../transcript.js";

export type TriageLlmConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const TRIAGE_SYSTEM = `你是微信私聊客服的「统一分流器」，不是客服本人。
只输出一行 JSON，不要 markdown，不要解释：
{"action":"continue|skip|handoff","reason":"简短中文","confidence":0.0到1.0}

三档含义：
- continue：需要客服正常回复（业务咨询、确认选项、有上下文的短附和、bot 刚提问后的嗯/好/行）
- skip：不必进主 Agent 的消息（身份/AI 试探、deflect 后的继续空撩、无业务推进的恶搞；不含空消息）
- handoff：明确要求人工、投诉、退款纠纷、法律威胁等高风险（不含单纯身份试探，那属于 skip）

兜底原则（极重要）：无法明确判定为 skip 或 handoff 时，一律 continue。Gate 的天职是放行，不是拦截。

confidence：对 action 把握程度，0 极不确定，1 极确定。`;

export function loadTriageLlmConfig(): TriageLlmConfig | undefined {
  if (process.env.WECHAT_TRIAGE_LLM_ENABLED === "false") return undefined;

  const apiKey =
    process.env.WECHAT_TRIAGE_API_KEY?.trim() ||
    process.env.TDAI_LLM_API_KEY?.trim() ||
    process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY?.trim();
  if (!apiKey) return undefined;

  const apiUrl = (
    process.env.WECHAT_TRIAGE_API_URL?.trim() ||
    process.env.TDAI_LLM_BASE_URL?.trim() ||
    process.env.XIAOMI_API_BASE?.trim() ||
    "https://token-plan-cn.xiaomimimo.com/v1"
  ).replace(/\/$/, "");

  const model =
    process.env.WECHAT_TRIAGE_MODEL?.trim() ||
    process.env.TDAI_LLM_MODEL?.trim() ||
    process.env.PI_MODEL?.trim() ||
    "deepseek-chat";

  return { apiUrl, apiKey, model };
}

type LlmTriagePayload = {
  action?: string;
  reason?: string;
  confidence?: number;
};

const VALID_GATES = new Set<GateAction>(["continue", "skip", "handoff"]);

function parseJsonPayload(text: string): LlmTriagePayload | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as LlmTriagePayload;
  } catch {
    return null;
  }
}

export type LlmGateOutcome = {
  gate: GateAction;
  reason: string;
  confidence: number;
  source: "llm";
};

export async function triageWithLlm(
  config: TriageLlmConfig,
  combinedText: string,
  chatState: ChatEscalationState,
  transcriptEntries: TranscriptEntry[] = [],
): Promise<LlmGateOutcome | null> {
  const user = [
    `deflectSent=${chatState.deflectSent}`,
    `probeStreak=${chatState.probeStreak}`,
    "",
    "【近期对话】",
    formatTranscriptForGate(transcriptEntries),
    "",
    "【本轮新消息】",
    combinedText,
  ].join("\n");

  const resp = await fetch(`${config.apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM },
        { role: "user", content: user },
      ],
      max_tokens: 120,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`triage LLM HTTP ${resp.status}: ${text.slice(0, 120)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const payload = parseJsonPayload(content);
  if (!payload?.action || !VALID_GATES.has(payload.action as GateAction)) {
    return null;
  }

  const confidence =
    typeof payload.confidence === "number" &&
    payload.confidence >= 0 &&
    payload.confidence <= 1
      ? payload.confidence
      : 0.5;

  return {
    gate: payload.action as GateAction,
    reason: payload.reason?.trim() || "llm",
    confidence,
    source: "llm",
  };
}
