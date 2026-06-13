import { describe, it, expect } from "vitest"
import { encodeChatDir } from "@cococat/shared/chat-id"
import {
  autoTagsFromEscalation,
  formatTriageSummary,
} from "./inbox-profile"

describe("inbox-profile", () => {
  it("encodeChatDir matches agent paths", () => {
    expect(encodeChatDir("12345678@chatroom")).toBe("_12345678_chatroom")
    expect(encodeChatDir("wxid_abc")).toBe("_wxid_abc")
  })

  it("autoTagsFromEscalation for escalate_a", () => {
    const tags = autoTagsFromEscalation(
      {
        chat_id: "x",
        chat_name: "张",
        reason: "escalate_a",
        muted_until: Date.now() + 3600_000,
        triggered_at: "",
      },
      { deflectSent: false, probeStreak: 0 },
    )
    expect(tags).toContain("转人工")
    expect(tags).toContain("投诉过")
  })

  it("formatTriageSummary when not muted", () => {
    expect(
      formatTriageSummary(null, { deflectSent: false, probeStreak: 0 }),
    ).toBe("REPLY · 无 mute")
  })
})
