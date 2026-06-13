import type { MimoAudioInput } from "./mimo-audio.js";
import { injectMimoAudioIntoPayload } from "./mimo-audio.js";

type OpenAIChatPayload = {
  messages?: Array<{
    role?: string;
    content?: unknown;
  }>;
};

export function replaceSystemInPayload(
  payload: unknown,
  systemText: string,
): unknown {
  const body = structuredClone(payload) as OpenAIChatPayload;
  const messages = body.messages;
  if (!Array.isArray(messages)) return payload;

  let replaced = false;
  for (const msg of messages) {
    if (msg.role === "system") {
      msg.content = systemText;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    messages.unshift({ role: "system", content: systemText });
  }
  return body;
}

const VOICE_CAPTION_HINT =
  "\n【语音说明】消息里的「发了一条语音：…」文字与音频是同一条语音的转写，以转写为准理解对方说了什么。";

export function applyPayloadHooks(
  payload: unknown,
  systemText: string,
  audios: MimoAudioInput[],
  hasVoiceWithCaption = false,
): unknown {
  let system = systemText;
  if (audios.length > 0 && hasVoiceWithCaption) {
    system += VOICE_CAPTION_HINT;
  }
  let next = replaceSystemInPayload(payload, system);
  if (audios.length > 0) {
    next = injectMimoAudioIntoPayload(next, audios) ?? next;
  }
  return next;
}
