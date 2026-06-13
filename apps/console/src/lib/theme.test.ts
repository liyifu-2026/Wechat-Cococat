import { describe, expect, it, beforeEach, vi } from "vitest"
import { LAYOUT_KEYS } from "@/lib/console-layout"
import { getStoredThemeMode } from "./theme"

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

describe("theme", () => {
  beforeEach(() => {
    mockLocalStorage()
  })

  it("defaults to system mode", () => {
    expect(getStoredThemeMode()).toBe("system")
  })

  it("reads persisted theme mode", () => {
    localStorage.setItem(LAYOUT_KEYS.theme, "dark")
    expect(getStoredThemeMode()).toBe("dark")
    localStorage.setItem(LAYOUT_KEYS.theme, "light")
    expect(getStoredThemeMode()).toBe("light")
    localStorage.setItem(LAYOUT_KEYS.theme, "bogus")
    expect(getStoredThemeMode()).toBe("system")
  })
})
