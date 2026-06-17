/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"
import { useConsoleStore } from "@/stores/console-store"

const BASE_INTERVAL_MS = 10_000

function renderVisibilityHook(
  callback: () => void | Promise<void>,
  delayMs: number,
  options: Parameters<typeof useVisibilityGatedInterval>[2] = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  function Harness() {
    useVisibilityGatedInterval(callback, delayMs, options)
    return null
  }

  act(() => {
    root.render(createElement(Harness))
  })

  return {
    unmount: () => {
      act(() => {
        root.unmount()
        container.remove()
      })
    },
  }
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
  })
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  })
}

describe("6C: useVisibilityGatedInterval catch-up contract", () => {
  const mockCallback = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setDocumentHidden(false)
    useConsoleStore.setState({ activeModule: "overview" })
  })

  afterEach(() => {
    vi.useRealTimers()
    setDocumentHidden(false)
  })

  it("fires catch-up immediately when tab becomes visible, then realigns to base interval", async () => {
    setDocumentHidden(true)

    const hook = renderVisibilityHook(mockCallback, BASE_INTERVAL_MS, {
      suspendWhenHidden: true,
    })

    vi.advanceTimersByTime(20_000)
    expect(mockCallback).not.toHaveBeenCalled()

    setDocumentHidden(false)
    document.dispatchEvent(new Event("visibilitychange"))
    await flushAsync()

    expect(mockCallback).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BASE_INTERVAL_MS)
    await flushAsync()

    expect(mockCallback).toHaveBeenCalledTimes(2)
    hook.unmount()
  })

  it("fires catch-up when activeModule enters allowedModules whitelist", async () => {
    const hook = renderVisibilityHook(mockCallback, BASE_INTERVAL_MS, {
      allowedModules: ["inbox"],
      suspendWhenHidden: true,
    })

    vi.advanceTimersByTime(20_000)
    expect(mockCallback).not.toHaveBeenCalled()

    act(() => {
      useConsoleStore.setState({ activeModule: "inbox" })
    })
    await flushAsync()

    expect(mockCallback).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it("does not poll while hidden; initial foreground run still happens once", async () => {
    const hook = renderVisibilityHook(mockCallback, BASE_INTERVAL_MS, {
      suspendWhenHidden: true,
    })

    await flushAsync()
    expect(mockCallback).toHaveBeenCalledTimes(1)

    setDocumentHidden(true)
    document.dispatchEvent(new Event("visibilitychange"))
    await flushAsync()

    vi.advanceTimersByTime(60_000)
    await flushAsync()

    expect(mockCallback).toHaveBeenCalledTimes(1)
    hook.unmount()
  })
})
