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
  return name.slice(0, 1) || "?"
}

const AVATAR_CLASSES = [
  "bg-[var(--wx-avatar-green)]",
  "bg-[var(--wx-avatar-blue)]",
  "bg-[var(--wx-avatar-orange)]",
] as const

export function chatAvatarClass(chatId: string): string {
  let hash = 0
  for (let i = 0; i < chatId.length; i++) {
    hash = (hash + chatId.charCodeAt(i)) % AVATAR_CLASSES.length
  }
  return AVATAR_CLASSES[hash] ?? AVATAR_CLASSES[0]
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
