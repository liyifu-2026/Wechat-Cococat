import { isTauri } from "@/lib/tauri-window"

/** Paths that must stay on plugin-http (binary / large JSON over IPC). */
export function shouldUseDriverProxy(path: string): boolean {
  if (!isTauri()) return false

  const pathname = path.split("?")[0]?.split("#")[0] ?? path

  if (pathname.includes("/avatar")) return false
  if (pathname.includes("/media/")) return false
  if (pathname.includes("/attachments")) return false
  if (pathname.includes("/debug/screenshot")) return false

  return true
}
