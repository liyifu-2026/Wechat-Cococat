import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/tauri-window"
import type { StackHealthService } from "@/lib/stack-client"
import type { ServiceHealth } from "@/lib/stack-status"

export type StackStatusLines = Record<StackHealthService, string>

export type StackHealthSnapshot = {
  driver: ServiceHealth
  memory: ServiceHealth
  agent: ServiceHealth
  wechatLoggedIn: boolean
  chatsReady: boolean
  chatsReadyReason?: string
  wechatAuthStatus: string
  wechatLoggedInUser?: string
  statusLines: StackStatusLines
  loading: boolean
}

/** Payload from Rust `get_stack_health_snapshot`. */
type RustStackHealthSnapshot = Omit<StackHealthSnapshot, "loading">

export function mapRustHealthSnapshot(
  raw: RustStackHealthSnapshot,
): Omit<StackHealthSnapshot, "loading"> {
  return {
    driver: raw.driver,
    memory: raw.memory,
    agent: raw.agent,
    wechatLoggedIn: raw.wechatLoggedIn,
    chatsReady: raw.chatsReady,
    chatsReadyReason: raw.chatsReadyReason,
    wechatAuthStatus: raw.wechatAuthStatus,
    wechatLoggedInUser: raw.wechatLoggedInUser,
    statusLines: { ...raw.statusLines },
  }
}

/** Tauri fast path — parallel Rust probes + 3s cache. Returns null outside Tauri or on failure. */
export async function fetchStackHealthSnapshot(
  force = false,
): Promise<Omit<StackHealthSnapshot, "loading"> | null> {
  if (!isTauri()) return null
  try {
    const raw = await invoke<RustStackHealthSnapshot>("get_stack_health_snapshot", {
      force,
    })
    return mapRustHealthSnapshot(raw)
  } catch (err) {
    console.warn("[stack-health] get_stack_health_snapshot failed:", err)
    return null
  }
}
