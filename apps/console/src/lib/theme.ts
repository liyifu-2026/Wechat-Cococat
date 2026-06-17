import { applyConsoleV2Theme } from "@/lib/console-theme"
import { LAYOUT_KEYS } from "@/lib/console-layout"

export type ThemeMode = "system" | "light" | "dark"

const MODES: readonly ThemeMode[] = ["system", "light", "dark"]

let systemListener: (() => void) | null = null

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function isDarkMode(mode: ThemeMode): boolean {
  if (mode === "dark") return true
  if (mode === "light") return false
  return prefersDark()
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", isDarkMode(mode))
  applyConsoleV2Theme(mode)
}

export function getStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(LAYOUT_KEYS.theme)
    if (raw && MODES.includes(raw as ThemeMode)) {
      return raw as ThemeMode
    }
  } catch {
    // ignore
  }
  return "system"
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(LAYOUT_KEYS.theme, mode)
  } catch {
    // ignore
  }
  applyThemeMode(mode)
  bindSystemThemeListener(mode)
}

/** Toggle between explicit light and dark (leaves system on first use). */
export function toggleLightDarkTheme(): ThemeMode {
  const next: ThemeMode = document.documentElement.classList.contains("dark")
    ? "light"
    : "dark"
  setThemeMode(next)
  return next
}

export function isDarkRendered(): boolean {
  return document.documentElement.classList.contains("dark")
}

function bindSystemThemeListener(mode: ThemeMode): void {
  if (systemListener) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .removeEventListener("change", systemListener)
    systemListener = null
  }
  if (mode !== "system") return
  systemListener = () => applyThemeMode("system")
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", systemListener)
}

/** Call once before React mount (main.tsx) and after hydration if needed. */
export function initTheme(): void {
  const mode = getStoredThemeMode()
  applyThemeMode(mode)
  bindSystemThemeListener(mode)
}
