import { useEffect } from "react"
import { isMacOS, isTauri } from "@/lib/tauri-window"

/** Apply platform classes on `<html>` for Tauri shell layout (macOS traffic lights). */
export function useWechatShellPlatform() {
  useEffect(() => {
    if (!isTauri()) return
    const html = document.documentElement
    html.classList.add("wechat-shell--tauri")
    if (isMacOS()) html.classList.add("wechat-shell--macos")
    return () => {
      html.classList.remove("wechat-shell--tauri", "wechat-shell--macos")
    }
  }, [])
}
