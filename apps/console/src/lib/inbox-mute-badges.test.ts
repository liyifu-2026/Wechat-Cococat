import { describe, expect, it } from "vitest"
import { isMutedEntry, isTodoMuteEntry } from "@/lib/inbox-mute-badges"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"

function entry(reason: string): EscalationMuteEntry {
  return {
    chat_id: "c1",
    chat_name: "Test",
    reason,
    muted_until: Date.now() + 3600_000,
    triggered_at: new Date().toISOString(),
  }
}

describe("inbox-mute-badges", () => {
  it("classifies todo vs muted reasons", () => {
    expect(isTodoMuteEntry(entry("escalate_a"))).toBe(true)
    expect(isTodoMuteEntry(entry("manual"))).toBe(false)
    expect(isMutedEntry(entry("manual"))).toBe(true)
    expect(isMutedEntry(entry("probe_b"))).toBe(true)
    expect(isMutedEntry(entry("escalate_a"))).toBe(false)
  })
})
