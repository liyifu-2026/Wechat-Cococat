import type { DriverMessage } from "@/lib/driver-client"

/** True when content is WeChat media XML rather than human-readable text. */
export function isWeChatMediaXml(content: string): boolean {
  const t = content.trim()
  if (!t.startsWith("<")) return false
  return (
    t.includes("<voicemsg") ||
    t.includes("<videomsg") ||
    t.includes("<img") ||
    (t.includes("<msg>") &&
      (t.includes("<voicemsg") ||
        t.includes("<videomsg") ||
        t.includes("<img") ||
        t.includes("<emoji")))
  )
}

/** Display/search-safe message body — never surfaces raw media XML. */
export function messageDisplayBody(
  m: Pick<DriverMessage, "content" | "mediaKind" | "type">,
  t: (key: string) => string,
): string {
  const base = m.type & 0x7fffffff
  if (base === 10002 || base === 10000) {
    const raw = m.content?.trim() ?? ""
    if (raw && !raw.startsWith("<")) return raw
    return t("wechat.inbox.messageRevoked")
  }

  const raw = m.content?.trim() ?? ""
  if (raw && !isWeChatMediaXml(raw)) return raw

  switch (m.mediaKind) {
    case "image":
    case "emoji":
      return t("wechat.inbox.mediaImage")
    case "voice":
      return t("wechat.inbox.mediaVoice")
    case "video":
      return t("wechat.inbox.mediaVideo")
    default:
      break
  }

  if (raw && isWeChatMediaXml(raw)) return ""
  return raw || `(${m.type})`
}
