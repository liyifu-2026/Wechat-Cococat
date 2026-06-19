/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  pruneMediaCacheForChat,
  useMessageMedia,
} from "./use-message-media-cache"

const mocks = vi.hoisted(() => ({
  fetchDriverMessageMedia: vi.fn(),
}))

vi.mock("@/lib/driver-client", () => ({
  fetchDriverMessageMedia: mocks.fetchDriverMessageMedia,
}))

function Harness({
  onState,
}: {
  onState: (state: ReturnType<typeof useMessageMedia>) => void
}) {
  const state = useMessageMedia("chat", 1, true)
  onState(state)
  return null
}

function latestState(states: Array<ReturnType<typeof useMessageMedia>>) {
  return states[states.length - 1]
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("useMessageMedia", () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const states: Array<ReturnType<typeof useMessageMedia>> = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    states.length = 0
    pruneMediaCacheForChat("chat")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    vi.useRealTimers()
    root = null
    container = null
  })

  it("keeps polling pending voice media until playable data is available", async () => {
    mocks.fetchDriverMessageMedia
      .mockResolvedValueOnce({
        type: "pending",
        format: "",
        filename: "",
      })
      .mockResolvedValueOnce({
        type: "voice",
        format: "mp3",
        filename: "voice.mp3",
        data: "abc",
      })

    act(() => {
      root!.render(createElement(Harness, { onState: (s) => states.push(s) }))
    })
    await flushAsync()

    expect(latestState(states)?.loading).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })
    await flushAsync()

    expect(mocks.fetchDriverMessageMedia).toHaveBeenCalledTimes(2)
    expect(latestState(states)?.loading).toBe(false)
    expect(latestState(states)?.media?.type).toBe("voice")
  })

  it("stops loading after pending media exceeds retry budget", async () => {
    mocks.fetchDriverMessageMedia.mockResolvedValue({
      type: "pending",
      format: "",
      filename: "",
    })

    act(() => {
      root!.render(createElement(Harness, { onState: (s) => states.push(s) }))
    })

    for (let i = 0; i < 12; i += 1) {
      await flushAsync()
      await act(async () => {
        vi.advanceTimersByTime(1500)
        await Promise.resolve()
      })
    }

    expect(latestState(states)?.loading).toBe(false)
    expect(latestState(states)?.media?.type).toBe("pending")
  })
})
