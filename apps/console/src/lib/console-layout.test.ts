import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  LAYOUT_KEYS,
  WECHAT_TABS,
  loadStoredTab,
  migrateLegacyModule,
  migrateStoredActiveModule,
  resolveWeChatTab,
  saveStoredTab,
} from "./console-layout"

function mockLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  })
}

describe("console-layout", () => {
  beforeEach(() => {
    mockLocalStorage()
  })

  it("loadStoredTab falls back when missing or invalid", () => {
    expect(loadStoredTab(LAYOUT_KEYS.wechatTab, WECHAT_TABS, "desktop")).toBe(
      "desktop",
    )
    saveStoredTab(LAYOUT_KEYS.wechatTab, "chats")
    expect(loadStoredTab(LAYOUT_KEYS.wechatTab, WECHAT_TABS, "desktop")).toBe(
      "chats",
    )
    saveStoredTab(LAYOUT_KEYS.wechatTab, "invalid")
    expect(loadStoredTab(LAYOUT_KEYS.wechatTab, WECHAT_TABS, "desktop")).toBe(
      "desktop",
    )
  })

  it("resolveWeChatTab forces connect when not ready", () => {
    expect(
      resolveWeChatTab({ stored: "desktop", driverUp: false, loggedIn: true }),
    ).toBe("connect")
    expect(
      resolveWeChatTab({ stored: "chats", driverUp: true, loggedIn: false }),
    ).toBe("connect")
    expect(
      resolveWeChatTab({ stored: "chats", driverUp: true, loggedIn: true }),
    ).toBe("chats")
  })

  it("migrateLegacyModule reroutes wiki to brain/kb", () => {
    expect(migrateLegacyModule("wiki")).toEqual({
      module: "brain",
      brainTab: "kb",
    })
  })

  it("migrateStoredActiveModule rewrites legacy wiki in localStorage", () => {
    saveStoredTab(LAYOUT_KEYS.activeModule, "wiki")
    expect(migrateStoredActiveModule("wiki")).toBe("brain")
    expect(localStorage.getItem(LAYOUT_KEYS.activeModule)).toBe("brain")
    expect(localStorage.getItem(LAYOUT_KEYS.brainTab)).toBe("kb")
  })
})
