export type CaptionLlmConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const CAPTION_PROMPT =
  "用一句客观中文描述内容，不要评价、不要 markdown、不要引号，不超过 40 字。";

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
      max_tokens: 80,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`caption LLM HTTP ${resp.status}: ${text.slice(0, 120)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  return content || undefined;
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
  return chatComplete(config, [
    {
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioDataUrl } },
        { type: "text", text: CAPTION_PROMPT },
      ],
    },
  ]);
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
