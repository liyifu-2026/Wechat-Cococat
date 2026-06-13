import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@cococat/shared";
import { isUnambiguousLowSignal } from "./low-signal.js";

describe("low-signal", () => {
  it("detects pure emoji messages", () => {
    const msgs = [{ localId: 1, type: 47, content: "[emoji]" }] as Message[];
    assert.equal(isUnambiguousLowSignal(msgs), true);
  });

  it("does not silent on short ack text", () => {
    const msgs = [{ localId: 1, type: 1, content: "好" }] as Message[];
    assert.equal(isUnambiguousLowSignal(msgs), false);
  });
});
