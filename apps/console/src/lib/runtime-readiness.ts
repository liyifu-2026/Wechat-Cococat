import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/tauri-window"

export type RuntimeReadinessState = "ready" | "missing" | "warning" | "unknown"

export type RuntimeReadinessItem = {
  id: string
  label: string
  state: RuntimeReadinessState
  detail: string
  action?: string
}

export type RuntimeReadiness = {
  overall: "ready" | "needsSetup"
  configDir: string
  dataDir: string
  items: RuntimeReadinessItem[]
}

export async function fetchRuntimeReadiness(): Promise<RuntimeReadiness | null> {
  if (!isTauri()) return null
  try {
    return await invoke<RuntimeReadiness>("get_runtime_readiness")
  } catch (err) {
    console.warn("[runtime-readiness] get_runtime_readiness failed:", err)
    return null
  }
}
