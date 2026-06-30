import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveTriageLlmConfig } from "./effective-config.js";

describe("resolveTriageLlmConfig", () => {
  test("uses a xiaomi-supported model when no model env is configured", () => {
    const config = resolveTriageLlmConfig({
      XIAOMI_TOKEN_PLAN_CN_API_KEY: "test-key",
    });

    assert.equal(config?.model, "mimo-v2-omni");
  });

  test("keeps explicit triage model ahead of shared model env", () => {
    const config = resolveTriageLlmConfig({
      XIAOMI_TOKEN_PLAN_CN_API_KEY: "test-key",
      WECHAT_TRIAGE_MODEL: "mimo-v2-pro",
      PI_MODEL: "deepseek-chat",
    });

    assert.equal(config?.model, "mimo-v2-pro");
  });

  test("treats blank triage model as unset and falls back to PI_MODEL", () => {
    const config = resolveTriageLlmConfig({
      XIAOMI_TOKEN_PLAN_CN_API_KEY: "test-key",
      WECHAT_TRIAGE_MODEL: "  ",
      PI_MODEL: "mimo-v2-pro",
    });

    assert.equal(config?.model, "mimo-v2-pro");
  });
});
