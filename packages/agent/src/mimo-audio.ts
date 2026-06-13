/** MiMo OpenAI-compatible audio part (see Xiaomi audio understanding docs). */
export type MimoAudioInput = {
  dataUrl: string;
};

type OpenAIChatPayload = {
  messages?: Array<{
    role?: string;
    content?: unknown;
  }>;
};

/**
 * Inject `input_audio` blocks into the last user message of an OpenAI chat/completions payload.
 * Used because pi-ai 0.78 only maps text+image in user content; mimo-v2.5 accepts input_audio.
 */
export function injectMimoAudioIntoPayload(
  payload: unknown,
  audios: MimoAudioInput[],
): unknown {
  if (audios.length === 0) return payload;

  const body = structuredClone(payload) as OpenAIChatPayload;
  const messages = body.messages;
  if (!Array.isArray(messages)) return payload;

  let userIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) return payload;

  const userMsg = messages[userIdx]!;
  const audioBlocks = audios.map((a) => ({
    type: "input_audio",
    input_audio: { data: a.dataUrl },
  }));

  if (typeof userMsg.content === "string") {
    userMsg.content = [
      ...audioBlocks,
      { type: "text", text: userMsg.content },
    ];
  } else if (Array.isArray(userMsg.content)) {
    userMsg.content = [...audioBlocks, ...userMsg.content];
  } else {
    userMsg.content = audioBlocks;
  }

  return body;
}
