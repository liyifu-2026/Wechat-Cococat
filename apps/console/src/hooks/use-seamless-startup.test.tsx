/**
 * @vitest-environment happy-dom
 */
import { createElement, StrictMode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isWechatSessionReady,
  useSeamlessStartup,
} from "./use-seamless-startup"

const mocks = vi.hoisted(() => ({
  refreshStackHealth: vi.fn(async () => undefined),
  fetchDriverSessionAuth: vi.fn(async () => ({ status: "logged_out" })),
  runStackOrchestrator: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/hooks/use-stack-health", () => ({
  refreshStackHealth: mocks.refreshStackHealth,
}))

vi.mock("@/lib/driver-client", () => ({
  fetchDriverSessionAuth: mocks.fetchDriverSessionAuth,
}))

vi.mock("@/lib/stack-orchestrator", () => ({
  runStackOrchestrator: mocks.runStackOrchestrator,
}))

function Harness() {
  useSeamlessStartup()
  return null
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("useSeamlessStartup", () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it("does not restart the boot effect on every state update", async () => {
    act(() => {
      root!.render(createElement(StrictMode, null, createElement(Harness)))
    })

    await flushAsync()

    expect(mocks.runStackOrchestrator.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("only treats WeChat as ready after chat DB is available", () => {
    expect(isWechatSessionReady({ status: "logged_in", chatsReady: true })).toBe(
      true,
    )
    expect(isWechatSessionReady({ status: "logged_in", chatsReady: false })).toBe(
      false,
    )
    expect(isWechatSessionReady({ status: "logged_out", chatsReady: true })).toBe(
      false,
    )
  })
})
