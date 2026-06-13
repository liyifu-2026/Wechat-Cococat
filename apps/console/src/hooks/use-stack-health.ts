import { useCallback, useEffect, useState } from "react"
import { fetchDriverSessionAuth } from "@/lib/driver-client"
import { stackCommand, type StackHealthService } from "@/lib/stack-client"
import { isFetchNetworkError } from "@/lib/tauri-fetch"
import { parseStackStatusLine, type ServiceHealth } from "@/lib/stack-status"

export type { StackHealthService } from "@/lib/stack-client"

export type StackStatusLines = Record<StackHealthService, string>

export type StackHealthSnapshot = {
  driver: ServiceHealth
  memory: ServiceHealth
  agent: ServiceHealth
  wechatLoggedIn: boolean
  /** Inbox / chats APIs can list conversations (WeChat DB keys present). */
  chatsReady: boolean
  chatsReadyReason?: string
  wechatAuthStatus: string
  wechatLoggedInUser?: string
  statusLines: StackStatusLines
  /** True while the first refresh has not completed yet. */
  loading: boolean
}

const EMPTY_STATUS_LINES: StackStatusLines = {
  driver: "",
  memory: "",
  agent: "",
}

const DEFAULT: StackHealthSnapshot = {
  driver: "unknown",
  memory: "unknown",
  agent: "unknown",
  wechatLoggedIn: false,
  chatsReady: false,
  chatsReadyReason: undefined,
  wechatAuthStatus: "unknown",
  wechatLoggedInUser: undefined,
  statusLines: { ...EMPTY_STATUS_LINES },
  loading: true,
}

let globalSnapshot: StackHealthSnapshot = { ...DEFAULT, statusLines: { ...EMPTY_STATUS_LINES } }
let listeners = new Set<() => void>()
let subscriberCount = 0
let refreshInFlight: Promise<void> | null = null

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

/** Force-refresh the shared stack health snapshot (e.g. after start/stop/login). */
export function refreshStackHealth(): Promise<void> {
  return refreshGlobalHealth()
}

async function refreshGlobalHealth(): Promise<void> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const next: StackHealthSnapshot = {
      driver: "unknown",
      memory: "unknown",
      agent: "unknown",
      wechatLoggedIn: false,
      chatsReady: false,
      chatsReadyReason: undefined,
      wechatAuthStatus: "unknown",
      wechatLoggedInUser: undefined,
      statusLines: { ...EMPTY_STATUS_LINES },
      loading: false,
    }

    for (const svc of ["driver", "memory", "agent"] as const satisfies readonly StackHealthService[]) {
      try {
        const out = await stackCommand(svc, "status")
        const trimmed = out.trim()
        const line = trimmed.split("\n")[0] ?? ""
        next.statusLines[svc] = trimmed || line || "ok"
        next[svc] = parseStackStatusLine(line)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        next.statusLines[svc] = msg
        next[svc] = "down"
      }
    }

    if (next.driver === "up") {
      try {
        const auth = await fetchDriverSessionAuth()
        next.wechatAuthStatus = auth.status ?? "unknown"
        next.wechatLoggedInUser = auth.loggedInUser
        next.wechatLoggedIn = auth.status === "logged_in"
        next.chatsReady =
          auth.chatsReady !== undefined
            ? auth.chatsReady === true
            : auth.status === "logged_in"
        next.chatsReadyReason = auth.chatsReadyReason
      } catch (err) {
        next.wechatAuthStatus = "unknown"
        next.wechatLoggedIn = false
        next.chatsReady = false
        next.chatsReadyReason = undefined
        next.wechatLoggedInUser = undefined
        if (isFetchNetworkError(err)) {
          next.driver = "degraded"
        }
      }
    }

    globalSnapshot = next
    notifyListeners()
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/**
 * Shared stack health — one poll loop for the whole Console so overview,
 * inbox, services, rail, and alerts always see the same snapshot.
 */
export function useStackHealth(_pollMs = 12000): StackHealthSnapshot {
  const [health, setHealth] = useState<StackHealthSnapshot>(globalSnapshot)

  const sync = useCallback(() => {
    setHealth({ ...globalSnapshot, statusLines: { ...globalSnapshot.statusLines } })
  }, [])

  useEffect(() => {
    listeners.add(sync)
    subscriberCount += 1
    sync()

    if (subscriberCount === 1) {
      void refreshGlobalHealth()
    }

    return () => {
      listeners.delete(sync)
      subscriberCount -= 1
    }
  }, [sync])

  return health
}
