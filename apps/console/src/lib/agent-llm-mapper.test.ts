import { describe, expect, it } from "vitest"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { mapPresetToAgentEnv } from "./agent-llm-mapper"

const fallback = {
  provider: "openai" as const,
  apiKey: "",
  model: "",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 131072,
}

describe("agent-llm-mapper", () => {
  it("maps xiaomi-mimo token plan to pi provider", () => {
    const preset = LLM_PRESETS.find((p) => p.id === "xiaomi-mimo")!
    const result = mapPresetToAgentEnv(
      preset,
      {
        apiKey: "sk-mimo",
        model: "mimo-v2.5",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      },
      fallback,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mapping.envVars.PI_PROVIDER).toBe("xiaomi-token-plan-cn")
      expect(result.mapping.envVars.PI_MODEL).toBe("mimo-v2.5")
      expect(result.mapping.envVars.XIAOMI_TOKEN_PLAN_CN_API_KEY).toBe("sk-mimo")
      expect(result.mapping.envVars.COCOCAT_AGENT_PRESET_ID).toBe("xiaomi-mimo")
    }
  })

  it("rejects CLI-only presets", () => {
    const preset = LLM_PRESETS.find((p) => p.id === "claude-code-cli")!
    expect(mapPresetToAgentEnv(preset, {}, fallback).ok).toBe(false)
  })
})
