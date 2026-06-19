import { describe, expect, it } from "vitest"
import { DRIVER_NEW_MESSAGES_EVENT } from "@/lib/driver-events"

describe("driver event bridge", () => {
  it("uses the Rust event bridge channel for new message events", () => {
    expect(DRIVER_NEW_MESSAGES_EVENT).toBe("driver://event/new_messages")
  })
})
