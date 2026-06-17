export type CapabilitySource = "static" | "heuristic" | "probed";

export type ModelCapabilities = {
  chat: boolean;
  vision: boolean;
  audio: boolean;
  reasoning: boolean;
  source: CapabilitySource;
};

const DEFAULT_CAPS: ModelCapabilities = {
  chat: true,
  vision: false,
  audio: false,
  reasoning: false,
  source: "heuristic",
};

/** Curated overrides where gateway behavior differs from naming or pi-ai is unavailable. */
const STATIC_OVERRIDES: Record<string, Partial<ModelCapabilities>> = {
  "mimo-v2.5": { vision: true, reasoning: true, source: "static" },
  "mimo-v2.5-pro": { vision: false, reasoning: true, source: "static" },
  "mimo-v2-omni": { vision: true, audio: true, reasoning: true, source: "static" },
  "mimo-v2-pro": { vision: false, reasoning: true, source: "static" },
  "mimo-v2-flash": { vision: true, reasoning: true, source: "static" },
  "deepseek-chat": { reasoning: true, source: "static" },
  "deepseek-v4-flash": { reasoning: true, source: "static" },
  "claude-sonnet-4-20250514": { vision: true, reasoning: true, source: "static" },
  "claude-sonnet-4-5-20250929": { vision: true, reasoning: true, source: "static" },
  "gpt-4o": { vision: true, audio: true, reasoning: true, source: "static" },
  "gpt-4o-mini": { vision: true, reasoning: true, source: "static" },
};

const VISION_NAME = /(?:^|[/_-])(vl|vision|4v|4o|omni|gemini[\d.-]*flash|qwen[\d.-]*vl)/i;
const AUDIO_NAME = /(?:^|[/_-])(omni|audio|gpt-4o-audio)/i;
const REASONING_NAME = /(?:^|[/_-])(r1|reason|think|o1|o3|pro|opus|sonnet[\d-]*$)/i;
const FLASH_NAME = /flash|haiku|lite|mini|nano/i;

export function resolveModelCapabilities(
  modelId: string,
  probed?: Partial<ModelCapabilities>,
): ModelCapabilities {
  if (probed) {
    return {
      chat: probed.chat ?? true,
      vision: probed.vision ?? false,
      audio: probed.audio ?? false,
      reasoning: probed.reasoning ?? false,
      source: "probed",
    };
  }

  const key = modelId.trim().toLowerCase();
  const base = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
  const staticHit = STATIC_OVERRIDES[base] ?? STATIC_OVERRIDES[key];
  if (staticHit) {
    return { ...DEFAULT_CAPS, ...staticHit, chat: true, source: "static" };
  }

  return {
    chat: true,
    vision: VISION_NAME.test(modelId),
    audio: AUDIO_NAME.test(modelId),
    reasoning: REASONING_NAME.test(modelId) && !FLASH_NAME.test(modelId),
    source: "heuristic",
  };
}

export function capabilityTags(caps: ModelCapabilities): string[] {
  const tags: string[] = ["文本"];
  if (caps.vision) tags.push("图像");
  if (caps.audio) tags.push("语音");
  if (caps.reasoning) tags.push("推理");
  return tags;
}

export function modelSupportsRole(
  caps: ModelCapabilities,
  role: "chat" | "caption" | "triage" | "wikiIngestCaption",
): boolean {
  switch (role) {
    case "chat":
    case "triage":
      return caps.chat;
    case "caption":
      return caps.chat && caps.vision;
    case "wikiIngestCaption":
      return caps.chat && caps.vision;
    default:
      return caps.chat;
  }
}

/** Suggest a same-vendor multimodal model when the primary lacks vision/audio. */
export function suggestMultimodalModel(modelId: string): string | undefined {
  const base = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
  if (/mimo-v2\.5-pro/i.test(base)) return "mimo-v2-omni";
  if (/mimo-v2\.5/i.test(base)) return "mimo-v2-omni";
  if (/mimo-v2-pro/i.test(base)) return "mimo-v2-omni";
  return undefined;
}
