import { describe, expect, it, vi } from "vitest"
import { captionInboxVoiceFromStack } from "@/lib/inbox-voice-caption"
import { resolveCaptionRoleLlm } from "@/lib/llm-stack-persist"

vi.mock("@/lib/llm-stack-persist", () => ({
  resolveCaptionRoleLlm: vi.fn(),
}))

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => globalThis.fetch),
}))

describe("captionInboxVoiceFromStack", () => {
  it("throws when caption role is missing", async () => {
    vi.mocked(resolveCaptionRoleLlm).mockResolvedValue(null)
    await expect(
      captionInboxVoiceFromStack("data:audio/mpeg;base64,abc"),
    ).rejects.toThrow("CAPTION_NOT_CONFIGURED")
  })
})
