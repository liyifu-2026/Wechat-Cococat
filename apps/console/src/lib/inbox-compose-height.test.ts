import { describe, expect, it } from "vitest"
import {
  clampComposeHeight,
  DEFAULT_COMPOSE_HEIGHT,
  MAX_COMPOSE_HEIGHT,
  MIN_COMPOSE_HEIGHT,
} from "@/lib/inbox-compose-height"

describe("inbox-compose-height", () => {
  it("clamps compose height within bounds", () => {
    expect(clampComposeHeight(80)).toBe(MIN_COMPOSE_HEIGHT)
    expect(clampComposeHeight(500)).toBe(MAX_COMPOSE_HEIGHT)
    expect(clampComposeHeight(180)).toBe(180)
  })

  it("uses a taller default than the old compact footer", () => {
    expect(DEFAULT_COMPOSE_HEIGHT).toBeGreaterThanOrEqual(180)
  })
})
