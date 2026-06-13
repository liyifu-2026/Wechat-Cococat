import type { ThemeMode } from "@/lib/theme"

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function isDarkMode(mode: ThemeMode): boolean {
  if (mode === "dark") return true
  if (mode === "light") return false
  return prefersDark()
}

/** v2 console palette — sage accent on warm neutral (mockup-aligned). */
export function applyConsoleV2Theme(mode: ThemeMode): void {
  const root = document.documentElement
  root.dataset.consoleV2 = isDarkMode(mode) ? "dark" : "light"
}
