import { describe, expect, it } from "vitest"
import { DEFAULT_ESCALATION, parseEscalationConfig } from "./escalation-config"

describe("escalation-config", () => {
  it("enables all notification categories by default", () => {
    expect(DEFAULT_ESCALATION.notifyOn).toEqual({
      escalate: true,
      probeLoop: true,
      lowConfidence: true,
    })
    expect(parseEscalationConfig("").notifyOn.lowConfidence).toBe(true)
  })

  it("keeps low-confidence notifications off only when explicitly disabled", () => {
    const parsed = parseEscalationConfig(
      JSON.stringify({ notifyOn: { lowConfidence: false } }),
    )
    expect(parsed.notifyOn.lowConfidence).toBe(false)
  })
})
