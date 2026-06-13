import { describe, expect, it } from "vitest"
import { resolveGatedDelayMs } from "./visibility-gate"

describe("resolveGatedDelayMs (Phase 6C)", () => {
  const visibleOverview = { hidden: false, activeModule: "overview" as const }

  it("returns base delay when gates are open", () => {
    expect(resolveGatedDelayMs(5000, visibleOverview)).toBe(5000)
  })

  it("suspends when document is hidden", () => {
    expect(
      resolveGatedDelayMs(5000, { hidden: true, activeModule: "overview" }),
    ).toBeNull()
  })

  it("suspends outside allowedModules when no degraded interval", () => {
    expect(
      resolveGatedDelayMs(5000, { hidden: false, activeModule: "brain" }, {
        allowedModules: ["inbox"],
      }),
    ).toBeNull()
  })

  it("degrades outside allowedModules when degradedIntervalMs is set", () => {
    expect(
      resolveGatedDelayMs(5000, { hidden: false, activeModule: "brain" }, {
        allowedModules: ["inbox"],
        degradedIntervalMs: 60_000,
      }),
    ).toBe(60_000)
  })

  it("allows full frequency inside allowedModules", () => {
    expect(
      resolveGatedDelayMs(5000, { hidden: false, activeModule: "inbox" }, {
        allowedModules: ["inbox"],
        degradedIntervalMs: 60_000,
      }),
    ).toBe(5000)
  })

  it("returns null for non-positive base delay", () => {
    expect(resolveGatedDelayMs(0, visibleOverview)).toBeNull()
  })
})
