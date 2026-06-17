import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveModelCapabilities,
  modelSupportsRole,
  suggestMultimodalModel,
} from "./model-capabilities.js";

describe("model-capabilities", () => {
  it("mimo-v2.5-pro is text-only", () => {
    const caps = resolveModelCapabilities("mimo-v2.5-pro");
    assert.equal(caps.vision, false);
    assert.equal(caps.reasoning, true);
    assert.equal(modelSupportsRole(caps, "caption"), false);
  });

  it("mimo-v2.5 supports vision", () => {
    const caps = resolveModelCapabilities("mimo-v2.5");
    assert.equal(caps.vision, true);
  });

  it("suggests omni for pro", () => {
    assert.equal(suggestMultimodalModel("mimo-v2.5-pro"), "mimo-v2-omni");
  });
});
