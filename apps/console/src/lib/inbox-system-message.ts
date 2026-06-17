import type { DriverMessage } from "@/lib/driver-types"

/** WeChat local message types (matches CLI / puppet maps). */
export const MSG_TYPE_SYSTEM = 10000
export const MSG_TYPE_REVOKE = 10002

function messageTypeBase(type: number): number {
  return type & 0x7fffffff
}

function extractSysmsgContent(raw: string): string | null {
  const match = raw.match(/<content>([\s\S]*?)<\/content>/i)
  if (!match?.[1]) return null
  return match[1].trim()
}

function normalizeSysmsgLabel(text: string): string {
  return text.trim().replace(/"/g, "")
}

export function isSystemMessage(
  message: Pick<DriverMessage, "type" | "content">,
): boolean {
  const base = messageTypeBase(message.type)
  if (base === MSG_TYPE_REVOKE || base === MSG_TYPE_SYSTEM) return true
  const raw = message.content?.trim() ?? ""
  return raw.includes("<sysmsg") && raw.includes("revokemsg")
}

export function systemMessageLabel(
  message: Pick<DriverMessage, "type" | "content">,
): string {
  const raw = message.content?.trim() ?? ""
  if (!raw) return ""

  if (!raw.startsWith("<") && !raw.includes("<sysmsg")) {
    return normalizeSysmsgLabel(raw)
  }

  const fromTag = extractSysmsgContent(raw)
  if (fromTag) return normalizeSysmsgLabel(fromTag)

  return normalizeSysmsgLabel(raw)
}
