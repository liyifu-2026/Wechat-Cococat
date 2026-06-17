import { invoke } from "@tauri-apps/api/core"
import { DRIVER_BASE_URL } from "@/lib/cococat-endpoints"
import { shouldUseDriverProxy } from "@/lib/driver-proxy-routing"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { readCococatToken } from "@/lib/stack-client"
import type {
  DriverChat,
  DriverContact,
  DriverMessage,
} from "@/lib/driver-types"

export type { DriverChat, DriverContact, DriverMessage } from "@/lib/driver-types"

export type DriverAuthStatus = {
  status?: string
  loggedInUser?: string
  /** True when session.db + contact.db keys are available for inbox APIs. */
  chatsReady?: boolean
  chatsReadyReason?: "missing_db_keys" | "no_account" | string
}

type DriverResponse = {
  ok: boolean
  status: number
  json: <T>() => Promise<T>
  text: () => Promise<string>
  blob: () => Promise<Blob>
}

function parseProxyErrorStatus(message: string): number {
  const match = /^Driver API \[(\d+)\]:/.exec(message)
  return match ? Number(match[1]) : 502
}

async function driverFetchViaInvoke(
  path: string,
  method: string,
  body?: unknown,
): Promise<DriverResponse> {
  try {
    const data = await invoke<unknown>("driver_fetch", {
      req: { path, method: method.toUpperCase(), body: body ?? null },
    })
    return {
      ok: true,
      status: 200,
      json: async <T>() => data as T,
      text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
      blob: async () => {
        throw new Error("driver_fetch proxy does not support blob()")
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = parseProxyErrorStatus(message)
    return {
      ok: false,
      status,
      json: async <T>() => {
        throw new Error(message)
        return undefined as T
      },
      text: async () => message,
      blob: async () => {
        throw new Error(message)
      },
    }
  }
}

async function driverFetchViaHttp(
  path: string,
  init?: RequestInit,
): Promise<DriverResponse> {
  const token = await readCococatToken()
  const httpFetch = await getHttpFetch()
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers ?? {}),
  }
  const res = await httpFetch(`${DRIVER_BASE_URL}${path}`, { ...init, headers })
  return {
    ok: res.ok,
    status: res.status,
    json: <T>() => res.json() as Promise<T>,
    text: () => res.text(),
    blob: () => res.blob(),
  }
}

function parseRequestBody(init?: RequestInit): unknown | undefined {
  if (!init?.body || typeof init.body !== "string") return undefined
  try {
    return JSON.parse(init.body) as unknown
  } catch {
    return undefined
  }
}

async function driverFetch(path: string, init?: RequestInit): Promise<DriverResponse> {
  const method = (init?.method ?? "GET").toUpperCase()

  if (shouldUseDriverProxy(path)) {
    return driverFetchViaInvoke(path, method, parseRequestBody(init))
  }

  return driverFetchViaHttp(path, init)
}

/** Cached session login state — no a11y probe (safe for polling). */
export async function fetchDriverSessionAuth(): Promise<DriverAuthStatus> {
  const res = await driverFetch("/api/status/session")
  if (res.status === 404) {
    return fetchDriverAuth()
  }
  if (!res.ok) throw new Error(`session auth HTTP ${res.status}`)
  return res.json<DriverAuthStatus>()
}

/** Live login state via a11y (use for login flow / manual refresh only). */
export async function fetchDriverAuth(): Promise<DriverAuthStatus> {
  const res = await driverFetch("/api/status/auth")
  if (!res.ok) throw new Error(`auth status HTTP ${res.status}`)
  return res.json<DriverAuthStatus>()
}

export async function fetchDriverChats(limit = 40): Promise<DriverChat[]> {
  const res = await driverFetch(`/api/chats?limit=${limit}`)
  if (!res.ok) throw new Error(`chats HTTP ${res.status}`)
  return res.json<DriverChat[]>()
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
  return res.json<DriverChat[]>()
}

/** Default page size for chat view pagination. */
export const INITIAL_MESSAGE_LIMIT = 20
export const LOAD_MORE_PAGE = 20

/** @deprecated use INITIAL_MESSAGE_LIMIT for inbox; kept for cross-chat search breadth */
export const DRIVER_MESSAGES_SEARCH_LIMIT = 200

export async function fetchDriverMessages(
  chatId: string,
  limit = INITIAL_MESSAGE_LIMIT,
  offset = 0,
): Promise<DriverMessage[]> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error(`messages HTTP ${res.status}`)
  return res.json<DriverMessage[]>()
}

export async function fetchDriverMessagesBefore(
  chatId: string,
  beforeTimeUnix: number,
  limit = LOAD_MORE_PAGE,
): Promise<DriverMessage[]> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&before_time=${beforeTimeUnix}`,
  )
  if (!res.ok) throw new Error(`messages before HTTP ${res.status}`)
  return res.json<DriverMessage[]>()
}

export async function fetchDriverMessagesAfter(
  chatId: string,
  afterTimeUnix: number,
  limit = LOAD_MORE_PAGE,
): Promise<DriverMessage[]> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&after_time=${afterTimeUnix}`,
  )
  if (!res.ok) throw new Error(`messages after HTTP ${res.status}`)
  return res.json<DriverMessage[]>()
}

export async function fetchDriverMessagesAround(
  chatId: string,
  localId: number,
  limit = INITIAL_MESSAGE_LIMIT,
): Promise<DriverMessage[]> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}/around/${localId}?limit=${limit}`,
  )
  if (!res.ok) {
    const detail = (await res.text()).trim()
    throw new Error(detail || `messages around HTTP ${res.status}`)
  }
  return res.json<DriverMessage[]>()
}

export type DriverMediaResult = {
  type: string
  data?: string
  url?: string
  format: string
  filename: string
  artifactRef?: string
}

export async function fetchDriverMessageMedia(
  chatId: string,
  localId: number,
): Promise<DriverMediaResult | null> {
  const res = await driverFetch(
    `/api/messages/${encodeURIComponent(chatId)}/media/${localId}`,
  )
  if (!res.ok) return null
  return res.json<DriverMediaResult>()
}

export async function fetchDriverContact(
  username: string,
): Promise<DriverContact | null> {
  const id = username.trim()
  if (!id) return null
  const res = await driverFetch(
    `/api/contacts/user/${encodeURIComponent(id)}`,
  )
  if (!res.ok) throw new Error(`contact HTTP ${res.status}`)
  const data = await res.json<DriverContact | null>()
  return data ?? null
}

export async function fetchDriverContacts(
  limit = 80,
  offset = 0,
): Promise<DriverContact[]> {
  const res = await driverFetch(
    `/api/contacts?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error(`contacts HTTP ${res.status}`)
  return res.json<DriverContact[]>()
}

export async function findDriverContacts(name: string): Promise<DriverContact[]> {
  const q = name.trim()
  if (!q) return []
  const res = await driverFetch(
    `/api/contacts/find?name=${encodeURIComponent(q)}`,
  )
  if (!res.ok) throw new Error(`contacts find HTTP ${res.status}`)
  return res.json<DriverContact[]>()
}

const avatarObjectUrlCache = new Map<string, string>()

/** Fetch avatar bytes via Driver CDN proxy; returns blob object URL for `<img>`. */
export async function fetchDriverAvatarObjectUrl(
  smallHeadUrl: string,
): Promise<string | null> {
  const url = smallHeadUrl.trim()
  if (!url) return null
  const cached = avatarObjectUrlCache.get(url)
  if (cached) return cached

  const res = await driverFetch(
    `/api/contacts/avatar?url=${encodeURIComponent(url)}`,
  )
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.size) return null
  const objectUrl = URL.createObjectURL(blob)
  avatarObjectUrlCache.set(url, objectUrl)
  return objectUrl
}

export type DriverSendResult = {
  success: boolean
  error?: string
}

export async function sendDriverMessage(params: {
  chatId: string
  text: string
  clientMsgId?: string
}): Promise<DriverSendResult> {
  const chatId = params.chatId.trim()
  const text = params.text.trim()
  if (!chatId || !text) {
    return { success: false, error: "chatId and text required" }
  }

  const body: Record<string, string> = { chatId, text }
  if (params.clientMsgId?.trim()) {
    body.clientMsgId = params.clientMsgId.trim()
  }

  const res = await driverFetch("/api/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    throw new Error(
      errBody ? `send HTTP ${res.status}: ${errBody}` : `send HTTP ${res.status}`,
    )
  }
  return res.json<DriverSendResult>()
}

export async function fetchDriverScreenshot(): Promise<string | null> {
  const res = await driverFetch("/api/debug/screenshot")
  if (!res.ok) throw new Error(`screenshot HTTP ${res.status}`)
  const data = await res.json<{ base64?: string }>()
  const raw = data.base64?.trim()
  if (!raw) return null
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`
}

export async function logoutDriver(): Promise<{ success: boolean; error?: string }> {
  const res = await driverFetch("/api/status/logout", { method: "POST" })
  if (!res.ok) throw new Error(`logout HTTP ${res.status}`)
  return res.json<{ success: boolean; error?: string }>()
}

/** Driver login WebSocket events — `#[serde(tag = "type")]` on the Rust side. */
export type LoginSubscriptionEvent =
  | { type: "status"; message: string }
  | { type: "qr"; qrData: string; qrBinaryData?: number[]; qrDataUrl?: string }
  | { type: "phone_confirm"; message?: string }
  | { type: "login_account"; message?: string }
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
  if (type === "login_account") {
    return {
      type: "login_account",
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

/** Explicitly reload Driver bearer token into the Rust-side cache. */
export async function refreshDriverTokenCache(): Promise<void> {
  await invoke<string>("refresh_driver_token_cache")
}

export { shouldUseDriverProxy } from "@/lib/driver-proxy-routing"
