import { describe, expect, it } from "vitest"
import {
  COMPOSE_LARGE_TEXT_THRESHOLD,
  isLargeComposeText,
} from "@/lib/compose-large-text"

describe("compose-large-text", () => {
  it("isLargeComposeText at threshold", () => {
    expect(isLargeComposeText("a".repeat(COMPOSE_LARGE_TEXT_THRESHOLD - 1))).toBe(
      false,
    )
    expect(isLargeComposeText("a".repeat(COMPOSE_LARGE_TEXT_THRESHOLD))).toBe(
      true,
    )
  })
})
