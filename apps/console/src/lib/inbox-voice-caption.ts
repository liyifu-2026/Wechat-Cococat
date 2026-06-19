import { resolveCaptionRoleLlm } from "@/lib/llm-stack-persist"
import { getHttpFetch } from "@/lib/tauri-fetch"

const VOICE_CAPTION_PROMPT =
  "只输出这段语音的中文转写，一行以内。不要解释、不要推理过程。"
const VOICE_CAPTION_TIMEOUT_MS = 30_000

type ChatCompletionMessage = {
  content?: string
  reasoning_content?: string
}

function withCaptionTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error("CAPTION_TIMEOUT"))
    }, VOICE_CAPTION_TIMEOUT_MS)
  })

  return Promise.race([work(controller.signal), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function extractCaptionText(
  message: ChatCompletionMessage | undefined,
): string | undefined {
  const content = message?.content?.trim()
  if (content) return content

  const reasoning = message?.reasoning_content?.trim()
  if (!reasoning) return undefined

  const quoted = [
    ...reasoning.matchAll(/[“"「『]([^”"」』\n]{2,120})[”"」』]/gu),
  ].map((m) => m[1]!.trim())
  if (quoted.length > 0) {
    return quoted[quoted.length - 1]
  }

  const lines = reasoning
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  if (
    last &&
    last.length <= 120 &&
    !/^(First|The user|I need|Let me|Okay|So,)/i.test(last)
  ) {
    return last
  }

  return undefined
}

export async function captionInboxVoiceFromStack(
  audioDataUrl: string,
): Promise<string> {
  const config = await resolveCaptionRoleLlm()
  if (!config) {
    throw new Error("CAPTION_NOT_CONFIGURED")
  }

  const httpFetch = await getHttpFetch()
  const resp = await withCaptionTimeout((signal) =>
    httpFetch(`${config.apiUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: audioDataUrl } },
              { type: "text", text: VOICE_CAPTION_PROMPT },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.2,
      }),
    }),
  )

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`caption LLM HTTP ${resp.status}: ${text.slice(0, 160)}`)
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: ChatCompletionMessage }>
  }
  const text = extractCaptionText(json.choices?.[0]?.message)?.trim()
  if (!text) {
    throw new Error("CAPTION_EMPTY")
  }
  return text
}
