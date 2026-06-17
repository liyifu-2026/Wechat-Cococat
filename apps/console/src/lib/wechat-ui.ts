import type { DriverChat } from "@/lib/driver-client"
import type { ServiceHealth } from "@/lib/stack-status"

export function wechatAuthHealth(status: string): ServiceHealth {
  if (status === "logged_in") return "up"
  if (status === "logged_out") return "degraded"
  if (status === "—" || status === "unknown") return "unknown"
  return "down"
}

export function chatDisplayName(chat: DriverChat): string {
  return chat.name ?? chat.remark ?? chat.username ?? chat.id
}

export function chatAvatarLetter(chat: DriverChat): string {
  const name = chatDisplayName(chat)
  return chatAvatarLetterFromText(name)
}

export function chatAvatarLetterFromText(name: string): string {
  return name.slice(0, 1) || "?"
}

/** Format RFC3339 timestamp for bubble meta. */
export function formatMessageTime(timestamp: string): string {
  const d = Date.parse(timestamp)
  if (Number.isNaN(d)) return timestamp
  try {
    return new Date(d).toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return timestamp
  }
}

const AVATAR_PALETTE = [
  {
    bg: "bg-[var(--wx-avatar-green)]",
    text: "text-[var(--wx-avatar-on-green)]",
  },
  {
    bg: "bg-[var(--wx-avatar-blue)]",
    text: "text-[var(--wx-avatar-on-blue)]",
  },
  {
    bg: "bg-[var(--wx-avatar-orange)]",
    text: "text-[var(--wx-avatar-on-orange)]",
  },
] as const

export function chatAvatarClass(colorKey: string): string {
  const styles = chatAvatarStyles(colorKey)
  return `${styles.bg} ${styles.text}`
}

export function chatAvatarStyles(colorKey: string): {
  bg: string
  text: string
} {
  let hash = 0
  for (let i = 0; i < colorKey.length; i++) {
    hash = (hash + colorKey.charCodeAt(i)) % AVATAR_PALETTE.length
  }
  return AVATAR_PALETTE[hash] ?? AVATAR_PALETTE[0]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function highlightText(text: string, query: string): string {
  const safe = escapeHtml(text)
  if (!query.trim()) return safe
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return safe.replace(
    new RegExp(`(${escaped})`, "gi"),
    "<mark class=\"wx-search-mark\">$1</mark>",
  )
}
