import { describe, expect, it, vi } from "vitest"
import { shouldUseDriverProxy } from "@/lib/driver-proxy-routing"

vi.mock("@/lib/tauri-window", () => ({
  isTauri: () => true,
}))

describe("shouldUseDriverProxy", () => {
  it("routes inbox JSON hot paths through invoke", () => {
    expect(shouldUseDriverProxy("/api/chats?limit=40")).toBe(true)
    expect(shouldUseDriverProxy("/api/messages/wxid_abc?limit=20")).toBe(true)
    expect(shouldUseDriverProxy("/api/messages/send")).toBe(true)
  })

  it("keeps binary-heavy paths on plugin-http", () => {
    expect(shouldUseDriverProxy("/api/contacts/avatar?url=x")).toBe(false)
    expect(shouldUseDriverProxy("/api/messages/chat/media/12")).toBe(false)
    expect(shouldUseDriverProxy("/api/debug/screenshot")).toBe(false)
  })
})
