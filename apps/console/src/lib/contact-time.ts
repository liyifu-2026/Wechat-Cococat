import { formatMessageTime } from "@/lib/wechat-ui"

export function formatContactTimestamp(
  value: string | number | null | undefined,
): string {
  if (value == null) return "—"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—"
    return formatMessageTime(new Date(value).toISOString())
  }
  const trimmed = value.trim()
  if (!trimmed) return "—"
  return formatMessageTime(trimmed)
}

export function contactTypeLabelKey(contactType: string): string {
  switch (contactType) {
    case "individual":
      return "wechat.contacts.contactTypeIndividual"
    case "chatroom":
      return "wechat.contacts.contactTypeChatroom"
    case "official":
      return "wechat.contacts.contactTypeOfficial"
    case "openim":
      return "wechat.contacts.contactTypeOpenim"
    default:
      return "wechat.contacts.contactTypeUnknown"
  }
}
