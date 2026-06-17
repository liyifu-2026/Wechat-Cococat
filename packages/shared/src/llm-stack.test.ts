import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLlmStack,
  resolveRole,
  resolveAllRoles,
} from "./llm-stack.js";

describe("llm-stack", () => {
  it("default stack suggests omni caption for mimo-v2.5-pro chat", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    const caption = resolveRole(stack, "caption");
    assert.equal(caption.providerId, "xiaomi-mimo");
    assert.equal(caption.model, "mimo-v2-omni");
  });

  it("inherit triage uses chat model", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5");
    const triage = resolveRole(stack, "triage");
    assert.equal(triage.model, "mimo-v2.5");
    assert.equal(triage.providerId, "xiaomi-mimo");
  });

  it("resolveAllRoles returns five roles", () => {
    const stack = defaultLlmStack("deepseek", "deepseek-chat");
    assert.equal(resolveAllRoles(stack).length, 5);
  });
});
