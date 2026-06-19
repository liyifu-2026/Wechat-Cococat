/**
 * @vitest-environment happy-dom
 */
import { createElement, StrictMode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WechatShell } from "./wechat-shell"
import { useConsoleStore } from "@/stores/console-store"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"

const mocks = vi.hoisted(() => ({
  listen: vi.fn(async () => () => undefined),
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "driver_fetch") return []
    if (cmd === "read_cococat_token_cmd") return "token"
    return null
  }),
  useSeamlessStartup: vi.fn(() => ({
    phase: "ready",
    loggedIn: true,
    errorMessage: null,
    bootStatus: null,
    retry: vi.fn(),
    completeLogin: vi.fn(),
  })),
  refreshStackHealth: vi.fn(async () => undefined),
  useStackHealth: vi.fn(() => ({
    driver: "up",
    memory: "up",
    agent: "up",
    wechatLoggedIn: true,
    chatsReady: true,
    wechatAuthStatus: "logged_in",
    statusLines: { driver: "", memory: "", agent: "" },
    loading: false,
  })),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    minimize: vi.fn(async () => undefined),
    onResized: vi.fn(async () => () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
  }),
}))

vi.mock("@/hooks/use-seamless-startup", () => ({
  useSeamlessStartup: mocks.useSeamlessStartup,
}))

vi.mock("@/hooks/use-stack-health", () => ({
  refreshStackHealth: mocks.refreshStackHealth,
  useStackHealth: mocks.useStackHealth,
}))

vi.mock("@/lib/project-store", () => ({
  getRecentProjects: vi.fn(async () => []),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("WechatShell render", () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    window.ResizeObserver = ResizeObserverStub
    useConsoleStore.setState({ activeWechatTab: "chats", activeModule: "inbox" })
    useInboxMuteStore.setState({
      mutes: [
        {
          chat_id: "wxid_test",
          chat_name: "Test",
          reason: "manual",
          muted_until: 0,
          triggered_at: "2026-06-19T00:00:00Z",
        },
      ],
    })
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

  it.each(["chats", "contacts", "kb"] as const)(
    "mounts the logged-in %s shell without recursive React updates",
    async (activeWechatTab) => {
      useConsoleStore.setState({ activeWechatTab, activeModule: "inbox" })

    expect(() => {
      act(() => {
        root!.render(createElement(StrictMode, null, createElement(WechatShell)))
      })
    }).not.toThrow()

    await flushAsync()
    },
  )
})
