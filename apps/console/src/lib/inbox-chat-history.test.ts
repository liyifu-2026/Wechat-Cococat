import { describe, expect, it } from "vitest"
import { matchesHistoryTab } from "@/lib/inbox-chat-history"
import type { DriverMessage } from "@/lib/driver-types"

function msg(
  partial: Partial<DriverMessage> & Pick<DriverMessage, "localId">,
): DriverMessage {
  return {
    type: 1,
    content: "",
    timestamp: "2024-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("inbox-chat-history", () => {
  it("matchesHistoryTab filters media kinds", () => {
    expect(matchesHistoryTab(msg({ localId: 1 }), "all")).toBe(true)
    expect(
      matchesHistoryTab(msg({ localId: 2, mediaKind: "image" }), "image"),
    ).toBe(true)
    expect(
      matchesHistoryTab(msg({ localId: 3, mediaKind: "emoji" }), "image"),
    ).toBe(true)
    expect(
      matchesHistoryTab(msg({ localId: 4, mediaKind: "voice" }), "voice"),
    ).toBe(true)
    expect(
      matchesHistoryTab(msg({ localId: 5, mediaKind: "voice" }), "image"),
    ).toBe(false)
  })
})
