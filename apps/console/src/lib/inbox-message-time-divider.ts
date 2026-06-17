import type { DriverMessage } from "@/lib/driver-types"
import { isSystemMessage, systemMessageLabel } from "@/lib/inbox-system-message"

/** Insert a divider when adjacent messages are farther apart than this (minutes). */
export const TIME_DIVIDER_GAP_MINUTES = 5

export function messageTimestampMs(message: DriverMessage): number {
  const t = Date.parse(message.timestamp ?? "")
  return Number.isNaN(t) ? 0 : t
}

function formatTimeOnly(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/** Centered timeline label: today → HH:MM; otherwise → weekday + HH:MM */
export function formatMessageDayDivider(
  timestamp: string,
  locale = "zh-CN",
  now: Date = new Date(),
): string {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) return timestamp
  const date = new Date(ms)
  const time = formatTimeOnly(date, locale)
  if (date.toDateString() === now.toDateString()) {
    return time
  }
  const weekday = date.toLocaleDateString(locale, { weekday: "long" })
  return `${weekday} ${time}`
}

export function shouldInsertTimeDivider(
  older: DriverMessage | null,
  newer: DriverMessage,
  gapMinutes = TIME_DIVIDER_GAP_MINUTES,
): boolean {
  if (!older?.timestamp || !newer.timestamp) return false
  const olderMs = messageTimestampMs(older)
  const newerMs = messageTimestampMs(newer)
  if (olderMs === 0 || newerMs === 0) return false

  const olderDate = new Date(olderMs)
  const newerDate = new Date(newerMs)
  if (olderDate.toDateString() !== newerDate.toDateString()) return true

  return newerMs - olderMs > gapMinutes * 60_000
}

export type InboxMessageRow =
  | { kind: "divider"; key: string; label: string }
  | { kind: "system"; key: string; label: string; message: DriverMessage; index: number }
  | { kind: "message"; key: string; message: DriverMessage; index: number }

/** Build render rows (oldest → newest) with time dividers and system notices. */
export function buildInboxMessageRows(
  orderedMessages: DriverMessage[],
): InboxMessageRow[] {
  const rows: InboxMessageRow[] = []
  let prev: DriverMessage | null = null

  for (let i = 0; i < orderedMessages.length; i++) {
    const message = orderedMessages[i]!
    if (shouldInsertTimeDivider(prev, message) && message.timestamp) {
      rows.push({
        kind: "divider",
        key: `divider-${message.localId ?? i}`,
        label: formatMessageDayDivider(message.timestamp),
      })
    }

    if (isSystemMessage(message)) {
      rows.push({
        kind: "system",
        key: `sys-${message.localId ?? i}`,
        label: systemMessageLabel(message),
        message,
        index: i,
      })
      prev = message
      continue
    }

    rows.push({
      kind: "message",
      key: `msg-${message.localId ?? i}`,
      message,
      index: i,
    })
    prev = message
  }

  return rows
}
