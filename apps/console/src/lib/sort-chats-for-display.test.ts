import { describe, expect, it } from "vitest"
import type { DriverChat } from "@/lib/driver-types"
import {
  partitionChatsForDisplay,
  sortChatsForDisplay,
} from "@/lib/sort-chats-for-display"

function chat(id: string, lastActivityAt?: string): DriverChat {
  return { id, lastActivityAt }
}

describe("sortChatsForDisplay", () => {
  it("orders maintainer before pinned before normal", () => {
    const chats = [
      chat("normal", "2026-01-03T10:00:00Z"),
      chat("pinned", "2026-01-01T10:00:00Z"),
      chat("maint", "2026-01-02T10:00:00Z"),
    ]
    const sorted = sortChatsForDisplay(
      chats,
      [{ chatId: "maint", displayName: "M" }],
      { pinnedAt: { pinned: 100 } },
    )
    expect(sorted.map((c) => c.id)).toEqual(["maint", "pinned", "normal"])
  })

  it("sorts pinned by pinnedAt desc", () => {
    const chats = [chat("p1"), chat("p2")]
    const sorted = sortChatsForDisplay(chats, [], {
      pinnedAt: { p1: 100, p2: 200 },
    })
    expect(sorted.map((c) => c.id)).toEqual(["p2", "p1"])
  })
})

describe("partitionChatsForDisplay", () => {
  it("splits pinned section including maintainers", () => {
    const chats = [chat("a"), chat("b"), chat("c")]
    const { pinnedSection, normalSection } = partitionChatsForDisplay(
      chats,
      new Set(["a"]),
      { b: 50 },
    )
    expect(pinnedSection.map((c) => c.id).sort()).toEqual(["a", "b"])
    expect(normalSection.map((c) => c.id)).toEqual(["c"])
  })
})
