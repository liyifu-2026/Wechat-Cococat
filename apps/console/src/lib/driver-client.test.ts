import { describe, expect, it } from "vitest"
import { parseLoginSubscriptionEvent } from "@/lib/driver-client"

describe("parseLoginSubscriptionEvent", () => {
  it("parses status events", () => {
    expect(
      parseLoginSubscriptionEvent({
        type: "status",
        message: "Navigating login flow...",
      }),
    ).toEqual({ type: "status", message: "Navigating login flow..." })
  })

  it("parses qr events", () => {
    expect(
      parseLoginSubscriptionEvent({
        type: "qr",
        qrData: "weixin://",
        qrDataUrl: "data:image/png;base64,abc",
      }),
    ).toEqual({
      type: "qr",
      qrData: "weixin://",
      qrDataUrl: "data:image/png;base64,abc",
    })
  })

  it("parses login_success", () => {
    expect(
      parseLoginSubscriptionEvent({ type: "login_success", userId: "wxid_1" }),
    ).toEqual({ type: "login_success", userId: "wxid_1" })
  })

  it("rejects legacy nested shape", () => {
    expect(
      parseLoginSubscriptionEvent({
        status: { message: "old" },
      }),
    ).toBeNull()
  })
})
