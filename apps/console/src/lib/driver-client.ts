import { DRIVER_BASE_URL } from "@/lib/cococat-endpoints"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { readCococatToken } from "@/lib/stack-client"

export type DriverAuthStatus = {
  status?: string
  loggedInUser?: string
  /** True when session.db + contact.db keys are available for inbox APIs. */
  chatsReady?: boolean
  chatsReadyReason?: "missing_db_keys" | "no_account" | string
}

export type DriverChat = {
  id: string
  name?: string
  username?: string
  remark?: string
  lastMessagePreview?: string
  isGroup?: boolean
  unreadCount?: number
}

export type DriverMessage = {
  localId?: number
  content?: string
  isSelf?: boolean
  type?: string
  timestamp?: string
}

async function driverFetch(path: string, init?: RequestInit) {
  const token = await readCococatToken()
  const httpFetch = await getHttpFetch()
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers ?? {}),
  }
  return httpFetch(`${DRIVER_BASE_URL}${path}`, { ...init, headers })
}

/** Cached session login state — no a11y probe (safe for polling). */
export async function fetchDriverSessionAuth(): Promise<DriverAuthStatus> {
  const res = await driverFetch("/api/status/session")
  if (res.status === 404) {
    return fetchDriverAuth()
  }
  if (!res.ok) throw new Error(`session auth HTTP ${res.status}`)
  return (await res.json()) as DriverAuthStatus
}

/** Live login state via a11y (use for login flow / manual refresh only). */
export async function fetchDriverAuth(): Promise<DriverAuthStatus> {
  const res = await driverFetch("/api/status/auth")
  if (!res.ok) throw new Error(`auth status HTTP ${res.status}`)
  return (await res.json()) as DriverAuthStatus
}

export async function fetchDriverChats(limit = 40): Promise<DriverChat[]> {
  const res = await driverFetch(`/api/chats?limit=${limit}`)
  if (!res.ok) throw new Error(`chats HTTP ${res.status}`)
  return (await res.json()) as DriverChat[]
}

export async function fetchDriverChatsFind(
  name: string,
): Promise<DriverChat[]> {
  const q = name.trim()
  if (!q) return []
  const res = await driverFetch(
    `/api/chats/find?name=${encodeURIComponent(q)}`,
  )
  if (!res.ok) throw new Error(`chats find HTTP ${res.status}`)
  return (await res.json()) as DriverChat[]
}

/** Max messages loaded for chat view + in-session search (Phase 2). */
export const DRIVER_MESSAGES_SEARCH_LIMIT = 200

export async function fetchDriverMessages(
  chatId: string,
  limit = 20,
): Promise<DriverMessage[]> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}?limit=${limit}`,
  )
  if (!res.ok) throw new Error(`messages HTTP ${res.status}`)
  return (await res.json()) as DriverMessage[]
}

export async function fetchDriverScreenshot(): Promise<string | null> {
  const res = await driverFetch("/api/debug/screenshot")
  if (!res.ok) throw new Error(`screenshot HTTP ${res.status}`)
  const data = (await res.json()) as { base64?: string }
  const raw = data.base64?.trim()
  if (!raw) return null
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`
}

export async function logoutDriver(): Promise<{ success: boolean; error?: string }> {
  const res = await driverFetch("/api/status/logout", { method: "POST" })
  if (!res.ok) throw new Error(`logout HTTP ${res.status}`)
  return (await res.json()) as { success: boolean; error?: string }
}

/** Driver login WebSocket events — `#[serde(tag = "type")]` on the Rust side. */
export type LoginSubscriptionEvent =
  | { type: "status"; message: string }
  | { type: "qr"; qrData: string; qrBinaryData?: number[]; qrDataUrl?: string }
  | { type: "phone_confirm"; message?: string }
  | { type: "login_success"; userId?: string }
  | { type: "login_timeout" }
  | { type: "error"; message: string }

export function parseLoginSubscriptionEvent(
  raw: unknown,
): LoginSubscriptionEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const type = e.type
  if (type === "status" && typeof e.message === "string") {
    return { type: "status", message: e.message }
  }
  if (type === "qr" && typeof e.qrData === "string") {
    return {
      type: "qr",
      qrData: e.qrData,
      qrBinaryData: Array.isArray(e.qrBinaryData)
        ? (e.qrBinaryData as number[])
        : undefined,
      qrDataUrl: typeof e.qrDataUrl === "string" ? e.qrDataUrl : undefined,
    }
  }
  if (type === "phone_confirm") {
    return {
      type: "phone_confirm",
      message: typeof e.message === "string" ? e.message : undefined,
    }
  }
  if (type === "login_success") {
    return {
      type: "login_success",
      userId: typeof e.userId === "string" ? e.userId : undefined,
    }
  }
  if (type === "login_timeout") return { type: "login_timeout" }
  if (type === "error" && typeof e.message === "string") {
    return { type: "error", message: e.message }
  }
  return null
}

export type LoginSocketHandlers = {
  onEvent: (event: LoginSubscriptionEvent) => void
  onError?: (err: Error) => void
  onClose?: () => void
}

export async function openDriverLoginSocket(
  handlers: LoginSocketHandlers,
): Promise<WebSocket> {
  const token = await readCococatToken()
  const wsBase = DRIVER_BASE_URL.replace(/^http/, "ws")
  const ws = new WebSocket(
    `${wsBase}/api/ws/login?token=${encodeURIComponent(token)}&timeoutMs=300000`,
  )
  ws.onmessage = (ev) => {
    try {
      const parsed = parseLoginSubscriptionEvent(
        JSON.parse(String(ev.data)) as unknown,
      )
      if (parsed) handlers.onEvent(parsed)
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      )
    }
  }
  ws.onerror = () => {
    handlers.onError?.(
      new Error(
        "Login WebSocket failed — is Driver running and is the token valid?",
      ),
    )
  }
  ws.onclose = () => {
    handlers.onClose?.()
  }
  return ws
}
