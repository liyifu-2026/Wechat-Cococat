export type CaptionLlmConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const CAPTION_PROMPT =
  "用一句客观中文描述内容，不要评价、不要 markdown、不要引号，不超过 40 字。";

const VOICE_CAPTION_PROMPT =
  "只输出这段语音的中文转写，一行以内。不要解释、不要推理过程。";

type ChatCompletionMessage = {
  content?: string;
  reasoning_content?: string;
};

/** omni 等推理模型常把结果写在 reasoning_content，content 为空。 */
export function extractCaptionText(
  message: ChatCompletionMessage | undefined,
): string | undefined {
  const content = message?.content?.trim();
  if (content) return content;

  const reasoning = message?.reasoning_content?.trim();
  if (!reasoning) return undefined;

  const quoted = [
    ...reasoning.matchAll(/[“"「『]([^”"」』\n]{2,120})[”"」』]/gu),
  ].map((m) => m[1]!.trim());
  if (quoted.length > 0) {
    return quoted[quoted.length - 1];
  }

  const lines = reasoning
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (
    last &&
    last.length <= 120 &&
    !/^(First|The user|I need|Let me|Okay|So,)/i.test(last)
  ) {
    return last;
  }

  return undefined;
}

export function loadCaptionLlmConfig(): CaptionLlmConfig | undefined {
  if (process.env.WECHAT_CAPTION_ENABLED === "false") return undefined;

  const apiKey =
    process.env.WECHAT_CAPTION_API_KEY?.trim() ||
    process.env.TDAI_LLM_API_KEY?.trim() ||
    process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY?.trim();
  if (!apiKey) return undefined;

  const apiUrl = (
    process.env.WECHAT_CAPTION_API_URL?.trim() ||
    process.env.TDAI_LLM_BASE_URL?.trim() ||
    process.env.XIAOMI_API_BASE?.trim() ||
    "https://token-plan-cn.xiaomimimo.com/v1"
  ).replace(/\/$/, "");

  const model =
    process.env.WECHAT_CAPTION_MODEL?.trim() ||
    process.env.TDAI_LLM_MODEL?.trim() ||
    process.env.PI_MODEL?.trim() ||
    "deepseek-chat";

  return { apiUrl, apiKey, model };
}

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
        | { type: "input_audio"; input_audio: { data: string } }
      >;
    };

async function chatComplete(
  config: CaptionLlmConfig,
  messages: ChatMessage[],
  maxTokens = 80,
): Promise<string | undefined> {
  const resp = await fetch(`${config.apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`caption LLM HTTP ${resp.status}: ${text.slice(0, 120)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: ChatCompletionMessage }>;
  };
  return extractCaptionText(json.choices?.[0]?.message);
}

export async function captionImage(
  config: CaptionLlmConfig,
  mimeType: string,
  base64Data: string,
): Promise<string | undefined> {
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  return chatComplete(config, [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        { type: "text", text: CAPTION_PROMPT },
      ],
    },
  ]);
}

export async function captionVoice(
  config: CaptionLlmConfig,
  audioDataUrl: string,
): Promise<string | undefined> {
  return chatComplete(
    config,
    [
      {
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: audioDataUrl } },
          { type: "text", text: VOICE_CAPTION_PROMPT },
        ],
      },
    ],
    256,
  );
}

export async function captionVideoCover(
  config: CaptionLlmConfig,
  mimeType: string,
  base64Data: string,
): Promise<string | undefined> {
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  return chatComplete(config, [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        {
          type: "text",
          text: "这是微信视频的封面图。" + CAPTION_PROMPT,
        },
      ],
    },
  ]);
}
