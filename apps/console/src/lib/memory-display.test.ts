import { describe, expect, it } from "vitest"
import {
  isMemoryGatewayHealthy,
  resolveMemoryDisplayState,
} from "./memory-display"

describe("memory-display", () => {
  it("resolveMemoryDisplayState distinguishes infra vs empty content", () => {
    expect(resolveMemoryDisplayState(false, [])).toBe("offline")
    expect(resolveMemoryDisplayState(false, ["x"])).toBe("offline")
    expect(resolveMemoryDisplayState(true, [])).toBe("empty")
    expect(resolveMemoryDisplayState(true, ["偏好咖啡"])).toBe("ready")
  })

  it("isMemoryGatewayHealthy requires stack up and health ok", () => {
    expect(isMemoryGatewayHealthy(true, "ok")).toBe(true)
    expect(isMemoryGatewayHealthy(false, "ok")).toBe(false)
    expect(isMemoryGatewayHealthy(true, "degraded")).toBe(false)
    expect(isMemoryGatewayHealthy(true, undefined)).toBe(false)
  })
})
