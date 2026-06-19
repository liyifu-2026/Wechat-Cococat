import type { DriverMessage } from "@/lib/driver-client"

export function messageIdentityKey(
  message: DriverMessage,
  fallbackChatId?: string,
): string {
  if (message.clientMsgId) return `client:${message.clientMsgId}`
  const chatId = message.chatId?.trim() || fallbackChatId?.trim() || ""
  return `${chatId}:${message.localId}`
}

export function messagesForChat(
  chatId: string,
  messages: DriverMessage[],
): DriverMessage[] {
  return messages.filter((m) => !m.chatId || m.chatId === chatId)
}

export function messageUnix(m: DriverMessage): number {
  const t = Date.parse(m.timestamp ?? "")
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}

export function oldestMessageUnix(messages: DriverMessage[]): number | null {
  if (messages.length === 0) return null
  let min = messageUnix(messages[0]!)
  for (const m of messages) {
    const t = messageUnix(m)
    if (t > 0 && t < min) min = t
  }
  return min > 0 ? min : null
}

export function newestMessageUnix(messages: DriverMessage[]): number | null {
  if (messages.length === 0) return null
  let max = 0
  for (const m of messages) {
    const t = messageUnix(m)
    if (t > max) max = t
  }
  return max > 0 ? max : null
}

export function mergeUniqueMessagesDesc(
  primary: DriverMessage[],
  extra: DriverMessage[],
  chatId?: string,
): DriverMessage[] {
  const byId = new Map<string, DriverMessage>()
  for (const m of [...primary, ...extra]) {
    if (m.localId != null) byId.set(messageIdentityKey(m, chatId), m)
  }
  return [...byId.values()].sort((a, b) => messageUnix(b) - messageUnix(a))
}
