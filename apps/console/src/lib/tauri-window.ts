import { isTauri } from "@tauri-apps/api/core"

export { isTauri }

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  return getCurrentWindow()
}

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false
  return (
    /Mac/i.test(navigator.userAgent) ||
    navigator.platform === "MacIntel" ||
    navigator.platform === "MacPPC"
  )
}

export function showCustomWindowControls(): boolean {
  return isTauri() && !isMacOS()
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).minimize()
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).toggleMaximize()
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).close()
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  return (await currentWindow()).isMaximized()
}
