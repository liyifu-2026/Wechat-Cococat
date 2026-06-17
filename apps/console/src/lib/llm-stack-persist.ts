import {
  defaultLlmStack,
  parseLlmStack,
  type LlmStackFile,
  type ProviderConfigs,
  type ResolvedRole,
  resolveAllRoles,
} from "@cococat/shared/llm-stack";
import type { LlmPreset } from "@/components/settings/llm-presets";
import { LLM_PRESETS } from "@/components/settings/llm-presets";
import { resolveConfig } from "@/components/settings/preset-resolver";
import type { LlmConfig, ProviderOverride } from "@/stores/wiki-store";
import { readConfigFile, writeConfigFile } from "./agent-config-client";
import {
  effectiveBaseUrl,
  mapPresetToAgentEnv,
  readAgentPresetIdFromEnv,
} from "./agent-llm-mapper";
import { applyAgentEnvVars, getEnvVar, parseEnvFile } from "./agent-env";
import { loadMultimodalConfig, saveMultimodalConfig } from "./project-store";
import { multimodalConfigFromWikiIngestRole } from "./llm-stack-multimodal-sync";
import type { MultimodalConfig } from "@/stores/wiki-store";

const STACK_FILE = "llm-stack.json";

export type PersistLlmStackInput = {
  stack: LlmStackFile;
  providerConfigs: ProviderConfigs;
  llmConfig: LlmConfig;
};

export type PersistLlmStackResult = {
  needsRestart: Array<"agent" | "memory">;
  multimodalConfig: MultimodalConfig;
};

function findPreset(providerId: string): LlmPreset | undefined {
  return LLM_PRESETS.find((p) => p.id === providerId);
}

function roleMapping(
  role: ResolvedRole,
  providerConfigs: ProviderConfigs,
  llmConfig: LlmConfig,
) {
  const preset = findPreset(role.providerId);
  if (!preset) return null;
  const override: ProviderOverride = {
    ...(providerConfigs[role.providerId] ?? {}),
    model: role.model,
  };
  return mapPresetToAgentEnv(preset, override, llmConfig);
}

function apiKeyFromMapping(envVars: Record<string, string>): string {
  for (const [key, value] of Object.entries(envVars)) {
    if (key.endsWith("_API_KEY") && value.trim()) return value.trim();
  }
  return "";
}

function apiUrlForRole(
  role: ResolvedRole,
  providerConfigs: ProviderConfigs,
): string {
  const preset = findPreset(role.providerId);
  if (!preset) return "";
  const ov = providerConfigs[role.providerId] ?? {};
  return effectiveBaseUrl(preset, ov).replace(/\/$/, "");
}

export async function loadLlmStackFile(): Promise<LlmStackFile | null> {
  const raw = await readConfigFile(STACK_FILE).catch(() => "");
  if (!raw.trim()) return null;
  try {
    return parseLlmStack(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function inferLlmStack(
  activePresetId: string | null,
  providerConfigs: ProviderConfigs,
  agentEnvRaw: string,
): Promise<LlmStackFile> {
  const fromFile = await loadLlmStackFile();
  if (fromFile) return fromFile;

  const agentPreset =
    readAgentPresetIdFromEnv(agentEnvRaw) ?? activePresetId ?? "xiaomi-mimo";
  const lines = parseEnvFile(agentEnvRaw);
  const piModel = getEnvVar(lines, "PI_MODEL")?.trim();
  const chatModel =
    piModel ||
    providerConfigs[agentPreset]?.model?.trim() ||
    findPreset(agentPreset)?.defaultModel ||
    "mimo-v2.5";

  const memoryLines = parseEnvFile(
    await readConfigFile("memory.env").catch(() => ""),
  );
  const memoryModel =
    getEnvVar(memoryLines, "TDAI_LLM_MODEL")?.trim() || "deepseek-v4-flash";

  return defaultLlmStack(agentPreset, chatModel, "deepseek", memoryModel);
}

export async function persistLlmStack(
  input: PersistLlmStackInput,
): Promise<PersistLlmStackResult> {
  const { stack, providerConfigs, llmConfig } = input;
  const roles = resolveAllRoles(stack);
  const chat = roles.find((r) => r.role === "chat");
  if (!chat) throw new Error("missing chat role");

  const chatMapped = roleMapping(chat, providerConfigs, llmConfig);
  if (!chatMapped?.ok) throw new Error("chat role mapping failed");

  let agentEnv = await readConfigFile("agent.env").catch(() => "");
  agentEnv = applyAgentEnvVars(agentEnv, chatMapped.mapping.envVars);

  const caption = roles.find((r) => r.role === "caption");
  const triage = roles.find((r) => r.role === "triage");
  const memory = roles.find((r) => r.role === "memoryRefine");

  const triagePatch: Record<string, string> = {};
  if (stack.unifiedGateLlm === false) {
    triagePatch.WECHAT_UNIFIED_GATE_LLM = "false";
  } else {
    triagePatch.WECHAT_UNIFIED_GATE_LLM = "true";
  }

  if (triage?.enabled !== false && triage) {
    const triageMapped = roleMapping(triage, providerConfigs, llmConfig);
    if (triageMapped?.ok) {
      triagePatch.WECHAT_TRIAGE_MODEL = triage.model;
      const url = apiUrlForRole(triage, providerConfigs);
      if (url) triagePatch.WECHAT_TRIAGE_API_URL = url;
      const key = apiKeyFromMapping(triageMapped.mapping.envVars);
      if (key) triagePatch.WECHAT_TRIAGE_API_KEY = key;
    }
  } else {
    triagePatch.WECHAT_TRIAGE_LLM_ENABLED = "false";
  }

  agentEnv = applyAgentEnvVars(agentEnv, triagePatch);
  await writeConfigFile("agent.env", agentEnv);

  let captionEnv = await readConfigFile("caption.env").catch(() => "");
  if (caption?.enabled !== false && caption) {
    const captionMapped = roleMapping(caption, providerConfigs, llmConfig);
    if (captionMapped?.ok) {
      const capPatch: Record<string, string> = {
        WECHAT_CAPTION_MODEL: caption.model,
      };
      const url = apiUrlForRole(caption, providerConfigs);
      if (url) capPatch.WECHAT_CAPTION_API_URL = url;
      const key = apiKeyFromMapping(captionMapped.mapping.envVars);
      if (key) capPatch.WECHAT_CAPTION_API_KEY = key;
      captionEnv = applyAgentEnvVars(captionEnv, capPatch);
    }
  } else {
    captionEnv = applyAgentEnvVars(captionEnv, {
      WECHAT_CAPTION_ENABLED: "false",
    });
  }
  await writeConfigFile("caption.env", captionEnv);

  if (memory) {
    const memoryMapped = roleMapping(memory, providerConfigs, llmConfig);
    let memoryEnv = await readConfigFile("memory.env").catch(() => "");
    if (memoryMapped?.ok) {
      const url = apiUrlForRole(memory, providerConfigs);
      const key = apiKeyFromMapping(memoryMapped.mapping.envVars);
      const memPatch: Record<string, string> = {
        TDAI_LLM_MODEL: memory.model,
      };
      if (url) memPatch.TDAI_LLM_BASE_URL = url;
      if (key) memPatch.TDAI_LLM_API_KEY = key;
      if (memory.providerId === "deepseek") {
        memPatch.TDAI_LLM_PROVIDER = "deepseek";
      }
      memoryEnv = applyAgentEnvVars(memoryEnv, memPatch);
    }
    await writeConfigFile("memory.env", memoryEnv);
  }

  await writeConfigFile(STACK_FILE, `${JSON.stringify(stack, null, 2)}\n`);

  const prevMultimodal = await loadMultimodalConfig();
  const multimodalConfig = multimodalConfigFromWikiIngestRole(
    stack,
    providerConfigs,
    llmConfig,
    prevMultimodal,
  );
  await saveMultimodalConfig(multimodalConfig);

  const { saveActivePresetId, saveLlmConfig, saveProviderConfigs } =
    await import("./project-store");
  await saveProviderConfigs(providerConfigs);
  await saveActivePresetId(chat.providerId);
  const chatPreset = findPreset(chat.providerId);
  if (chatPreset) {
    const resolved = resolveConfig(
      chatPreset,
      { ...providerConfigs[chat.providerId], model: chat.model },
      llmConfig,
    );
    await saveLlmConfig(resolved);
  }

  return { needsRestart: ["agent", "memory"], multimodalConfig };
}

export function stackFromActivePreset(
  activePresetId: string,
  providerConfigs: ProviderConfigs,
): LlmStackFile {
  const model =
    providerConfigs[activePresetId]?.model?.trim() ||
    findPreset(activePresetId)?.defaultModel ||
    "mimo-v2.5";
  return defaultLlmStack(activePresetId, model);
}

export type CaptionRoleLlm = {
  apiUrl: string
  apiKey: string
  model: string
}

/** Resolved llm-stack `caption` role for inbox voice transcription. */
export async function resolveCaptionRoleLlm(): Promise<CaptionRoleLlm | null> {
  const { loadLlmConfig, loadProviderConfigs } = await import("./project-store");
  const llmConfig = await loadLlmConfig();
  if (!llmConfig) return null;

  const providerConfigs = (await loadProviderConfigs()) ?? {};
  const stack =
    (await loadLlmStackFile()) ??
    (await inferLlmStack(null, providerConfigs, ""));

  const caption = resolveAllRoles(stack).find((r) => r.role === "caption");
  if (!caption || caption.enabled === false) return null;

  const mapped = roleMapping(caption, providerConfigs, llmConfig);
  if (!mapped?.ok) return null;

  const apiKey = apiKeyFromMapping(mapped.mapping.envVars);
  if (!apiKey) return null;

  const apiUrl = apiUrlForRole(caption, providerConfigs).replace(/\/$/, "");
  if (!apiUrl) return null;

  return { apiUrl, apiKey, model: caption.model };
}

export { STACK_FILE };
