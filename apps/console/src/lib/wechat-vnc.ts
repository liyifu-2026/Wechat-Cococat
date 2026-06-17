import { openUrl } from "@tauri-apps/plugin-opener"
import { DRIVER_BASE_URL } from "@/lib/cococat-endpoints"
import { readCococatToken } from "@/lib/stack-client"

export function buildWechatVncUrl(token: string): string {
  return `${DRIVER_BASE_URL}/vnc/?token=${encodeURIComponent(token)}&autoconnect=true&reconnect=true&reconnect_delay=2000`
}

export async function openWechatVncInBrowser(): Promise<boolean> {
  try {
    const token = await readCococatToken()
    if (!token?.trim()) return false
    await openUrl(buildWechatVncUrl(token))
    return true
  } catch (err) {
    console.warn("[vnc] failed to open browser:", err)
    return false
  }
}
