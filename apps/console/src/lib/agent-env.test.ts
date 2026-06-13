import { describe, expect, it } from "vitest"
import {
  applyAgentLlmToEnv,
  getEnvVar,
  parseEnvFile,
  setEnvVar,
} from "./agent-env"

describe("agent-env", () => {
  it("parses and updates PI_PROVIDER without dropping comments", () => {
    const raw = "# WeChat agent\nPI_PROVIDER=anthropic\nPI_MODEL=old\n"
    const lines = parseEnvFile(raw)
    expect(getEnvVar(lines, "PI_PROVIDER")).toBe("anthropic")
    const next = setEnvVar(lines, "PI_PROVIDER", "xiaomi-token-plan-cn")
    expect(getEnvVar(next, "PI_PROVIDER")).toBe("xiaomi-token-plan-cn")
    expect(next[0]?.kind).toBe("comment")
  })

  it("applyAgentLlmToEnv writes provider, model, and api key", () => {
    const out = applyAgentLlmToEnv("", {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5",
      apiKeyVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY",
      apiKey: "sk-test",
    })
    expect(out).toContain("PI_PROVIDER=xiaomi-token-plan-cn")
    expect(out).toContain("PI_MODEL=mimo-v2.5")
    expect(out).toContain("XIAOMI_TOKEN_PLAN_CN_API_KEY=sk-test")
  })
})
