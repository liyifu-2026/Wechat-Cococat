import type { LlmPreset } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import type { LlmConfig, ProviderOverride } from "@/stores/wiki-store"
import { getEnvVar, parseEnvFile, type EnvLine } from "./agent-env"

export const AGENT_PRESET_ID_ENV = "COCOCAT_AGENT_PRESET_ID"

/** Presets that cannot be mapped to pi-ai for the WeChat Agent runtime. */
export const AGENT_UNSUPPORTED_PRESET_IDS = new Set([
  "claude-code-cli",
  "codex-cli",
  "ollama-local",
  "ollama-cloud",
  "azure",
  "custom",
  "volcengine-ark",
])

export type AgentEnvMapping = {
  presetId: string
  envVars: Record<string, string>
}

export type AgentMappingResult =
  | { ok: true; mapping: AgentEnvMapping }
  | { ok: false; reasonKey: string }

export function effectiveBaseUrl(preset: LlmPreset, ov: ProviderOverride): string {
  const apiMode = ov.apiMode ?? preset.apiMode ?? "chat_completions"
  return ov.baseUrl ?? preset.baseUrlByMode?.[apiMode] ?? preset.baseUrl ?? ""
}

function buildMapping(
  presetId: string,
  piProvider: string,
  piModel: string,
  apiKeyVar: string,
  apiKey: string,
): AgentEnvMapping {
  const envVars: Record<string, string> = {
    [AGENT_PRESET_ID_ENV]: presetId,
    PI_PROVIDER: piProvider,
    PI_MODEL: piModel,
  }
  if (apiKeyVar && apiKey.trim()) {
    envVars[apiKeyVar] = apiKey.trim()
  }
  return { presetId, envVars }
}

export function mapPresetToAgentEnv(
  preset: LlmPreset,
  override: ProviderOverride | undefined,
  fallback: LlmConfig,
): AgentMappingResult {
  if (AGENT_UNSUPPORTED_PRESET_IDS.has(preset.id)) {
    return { ok: false, reasonKey: "settings.sections.agentLlm.unsupportedPreset" }
  }

  const resolved = resolveConfig(preset, override, fallback)
  const ov = override ?? {}
  const model = (ov.model ?? preset.defaultModel ?? resolved.model).trim()
  const apiKey = (ov.apiKey ?? resolved.apiKey ?? "").trim()

  if (!model) {
    return { ok: false, reasonKey: "settings.sections.agentLlm.errors.missingModel" }
  }

  switch (preset.id) {
    case "anthropic":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "anthropic", model, "ANTHROPIC_API_KEY", apiKey),
      }
    case "openai":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "openai", model, "OPENAI_API_KEY", apiKey),
      }
    case "google":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "google", model, "GEMINI_API_KEY", apiKey),
      }
    case "deepseek":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "deepseek", model, "DEEPSEEK_API_KEY", apiKey),
      }
    case "groq":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "groq", model, "GROQ_API_KEY", apiKey),
      }
    case "xai":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "xai", model, "XAI_API_KEY", apiKey),
      }
    case "nvidia-nim":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "nvidia", model, "NVIDIA_API_KEY", apiKey),
      }
    case "kimi":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "moonshotai", model, "MOONSHOT_API_KEY", apiKey),
      }
    case "kimi-cn":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "moonshotai-cn", model, "MOONSHOT_API_KEY", apiKey),
      }
    case "minimax-global":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "minimax", model, "MINIMAX_API_KEY", apiKey),
      }
    case "minimax-cn":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "minimax-cn", model, "MINIMAX_CN_API_KEY", apiKey),
      }
    case "bailian-coding":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "zai-coding-cn", model, "ZAI_CODING_CN_API_KEY", apiKey),
      }
    case "zhipu":
      return {
        ok: true,
        mapping: buildMapping(preset.id, "zai", model, "ZAI_API_KEY", apiKey),
      }
    case "xiaomi-mimo": {
      const base = effectiveBaseUrl(preset, ov)
      if (base.includes("token-plan-cn") || base.includes("/anthropic")) {
        return {
          ok: true,
          mapping: buildMapping(
            preset.id,
            "xiaomi-token-plan-cn",
            model,
            "XIAOMI_TOKEN_PLAN_CN_API_KEY",
            apiKey,
          ),
        }
      }
      return {
        ok: true,
        mapping: buildMapping(preset.id, "xiaomi", model, "XIAOMI_API_KEY", apiKey),
      }
    }
    default:
      if (preset.provider === "anthropic") {
        return {
          ok: true,
          mapping: buildMapping(preset.id, "anthropic", model, "ANTHROPIC_API_KEY", apiKey),
        }
      }
      if (preset.provider === "openai") {
        return {
          ok: true,
          mapping: buildMapping(preset.id, "openai", model, "OPENAI_API_KEY", apiKey),
        }
      }
      if (preset.provider === "google") {
        return {
          ok: true,
          mapping: buildMapping(preset.id, "google", model, "GEMINI_API_KEY", apiKey),
        }
      }
      return { ok: false, reasonKey: "settings.sections.agentLlm.unsupportedPreset" }
  }
}

const PI_PROVIDER_TO_PRESET: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  groq: "groq",
  xai: "xai",
  nvidia: "nvidia-nim",
  moonshotai: "kimi",
  "moonshotai-cn": "kimi-cn",
  minimax: "minimax-global",
  "minimax-cn": "minimax-cn",
  "zai-coding-cn": "bailian-coding",
  zai: "zhipu",
  "xiaomi-token-plan-cn": "xiaomi-mimo",
  xiaomi: "xiaomi-mimo",
}

export function readAgentPresetIdFromEnv(content: string): string | null {
  const lines = parseEnvFile(content)
  const stored = getEnvVar(lines, AGENT_PRESET_ID_ENV)?.trim()
  if (stored) return stored

  const provider = getEnvVar(lines, "PI_PROVIDER") ?? getEnvVar(lines, "LLM_PROVIDER")
  if (!provider) return null
  return PI_PROVIDER_TO_PRESET[provider] ?? null
}

export function readAgentPresetIdFromLines(lines: EnvLine[]): string | null {
  return readAgentPresetIdFromEnv(lines.map((l) => l.raw).join("\n"))
}
