import { afterEach, describe, expect, it, vi } from "vitest"
import { captionInboxVoiceFromStack } from "@/lib/inbox-voice-caption"
import { resolveCaptionRoleLlm } from "@/lib/llm-stack-persist"

vi.mock("@/lib/llm-stack-persist", () => ({
  resolveCaptionRoleLlm: vi.fn(),
}))

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => globalThis.fetch),
}))

describe("captionInboxVoiceFromStack", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("throws when caption role is missing", async () => {
    vi.mocked(resolveCaptionRoleLlm).mockResolvedValue(null)
    await expect(
      captionInboxVoiceFromStack("data:audio/mpeg;base64,abc"),
    ).rejects.toThrow("CAPTION_NOT_CONFIGURED")
  })

  it("passes an abort signal to the caption request", async () => {
    vi.mocked(resolveCaptionRoleLlm).mockResolvedValue({
      provider: "openai-compatible",
      apiUrl: "https://example.test/v1",
      apiKey: "key",
      model: "voice-model",
    } as never)
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "你好" } }] }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      captionInboxVoiceFromStack("data:audio/mpeg;base64,abc"),
    ).resolves.toBe("你好")

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toMatchObject({
      method: "POST",
      signal: expect.any(AbortSignal),
    })
  })

  it("times out stuck caption requests", async () => {
    vi.useFakeTimers()
    vi.mocked(resolveCaptionRoleLlm).mockResolvedValue({
      provider: "openai-compatible",
      apiUrl: "https://example.test/v1",
      apiKey: "key",
      model: "voice-model",
    } as never)
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined),
    )
    vi.stubGlobal("fetch", fetchMock)

    const promise = captionInboxVoiceFromStack("data:audio/mpeg;base64,abc")
    const assertion = expect(promise).rejects.toThrow("CAPTION_TIMEOUT")

    await vi.advanceTimersByTimeAsync(30_000)

    await assertion
  })
})
