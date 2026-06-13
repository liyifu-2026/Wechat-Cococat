import type { ChatEscalationState, TriageAction, TriageResult } from "./types.js";
import { formatTranscriptForGate } from "../transcript-context.js";
import type { TranscriptEntry } from "../transcript.js";

export type TriageLlmConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const TRIAGE_SYSTEM = `你是微信私聊客服的「统一分流器」，不是客服本人。
只输出一行 JSON，不要 markdown，不要解释：
{"action":"reply|silent|deflect|ignore|escalate_a|probe_b","reason":"简短中文","confidence":0.0到1.0}

含义：
- reply：需要客服正常回复（含在回答 bot 提问、确认选项、业务咨询、短附和但有上下文）
- silent：低信息量且不必回复（对话已结束后的嗯/好、纯附和、无业务推进）
- deflect：首次试探是否 AI/机器人（简短_redirect，不要辩论）
- ignore：DEFLECT 后的继续试探、空撩、恶搞（不应再回）
- escalate_a：明确要求人工、投诉、退款纠纷、法律威胁等高风险
- probe_b：DEFLECT 后仍连续纠缠身份（升级维护者）

判 silent vs reply 时必看【近期对话】：若 bot 刚提问/等确认，客户的「好/嗯/行」→ reply。
confidence：你对 action 把握程度，0 极不确定，1 极确定。`;

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
    "deepseek-chat";

  return { apiUrl, apiKey, model };
}

type LlmTriagePayload = {
  action?: string;
  reason?: string;
  confidence?: number;
};

const VALID_ACTIONS = new Set<TriageAction>([
  "reply",
  "silent",
  "deflect",
  "ignore",
  "escalate_a",
  "probe_b",
]);

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

export type LlmTriageOutcome = TriageResult & {
  confidence: number;
  source: "llm" | "rules";
};

export async function triageWithLlm(
  config: TriageLlmConfig,
  combinedText: string,
  chatState: ChatEscalationState,
  transcriptEntries: TranscriptEntry[] = [],
): Promise<LlmTriageOutcome | null> {
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
  if (!payload?.action || !VALID_ACTIONS.has(payload.action as TriageAction)) {
    return null;
  }

  const confidence =
    typeof payload.confidence === "number" &&
    payload.confidence >= 0 &&
    payload.confidence <= 1
      ? payload.confidence
      : 0.5;

  return {
    action: payload.action as TriageAction,
    reason: payload.reason?.trim() || "llm",
    confidence,
    source: "llm",
  };
}
