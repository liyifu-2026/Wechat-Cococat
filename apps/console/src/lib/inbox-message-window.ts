import type { DriverMessage } from "@/lib/driver-client"

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
): DriverMessage[] {
  const byId = new Map<number, DriverMessage>()
  for (const m of [...primary, ...extra]) {
    if (m.localId != null) byId.set(m.localId, m)
  }
  return [...byId.values()].sort((a, b) => messageUnix(b) - messageUnix(a))
}
