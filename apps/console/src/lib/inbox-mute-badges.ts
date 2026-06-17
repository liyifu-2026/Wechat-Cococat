import type { EscalationMuteEntry } from "@/lib/agent-config-client"

export function isTodoMuteEntry(
  entry: EscalationMuteEntry | null | undefined,
): boolean {
  if (!entry) return false
  return entry.reason === "escalate_a" || entry.reason === "escalate"
}

export function isMutedEntry(
  entry: EscalationMuteEntry | null | undefined,
): boolean {
  if (!entry) return false
  return !isTodoMuteEntry(entry)
}
