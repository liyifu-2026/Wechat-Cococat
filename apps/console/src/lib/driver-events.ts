/** Tauri event channel for Driver `new_messages` WS payloads. */
export const DRIVER_NEW_MESSAGES_EVENT = "driver://event/new_messages"

export type DriverNewMessagesEvent = {
  type: "new_messages"
  chats: Array<{ chatId: string }>
  timestamp?: string
}

export function parseDriverEvent(raw: unknown): DriverNewMessagesEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  if (e.type !== "new_messages" || !Array.isArray(e.chats)) return null
  const chats = e.chats
    .map((c) => {
      if (!c || typeof c !== "object") return null
      const chatId = (c as Record<string, unknown>).chatId
      return typeof chatId === "string" ? { chatId } : null
    })
    .filter(Boolean) as Array<{ chatId: string }>
  return {
    type: "new_messages",
    chats,
    timestamp: typeof e.timestamp === "string" ? e.timestamp : undefined,
  }
}
