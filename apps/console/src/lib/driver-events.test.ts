import { describe, expect, it } from "vitest"
import { parseDriverEvent } from "@/lib/driver-events"

describe("parseDriverEvent", () => {
  it("accepts new_messages payloads", () => {
    const parsed = parseDriverEvent({
      type: "new_messages",
      chats: [{ chatId: "wxid_a" }, { chatId: "wxid_b" }],
      timestamp: "2026-01-01T00:00:00Z",
    })
    expect(parsed?.chats.map((c) => c.chatId)).toEqual(["wxid_a", "wxid_b"])
  })

  it("rejects malformed payloads", () => {
    expect(parseDriverEvent(null)).toBeNull()
    expect(parseDriverEvent({ type: "other" })).toBeNull()
  })
})
