import { useEscalationMuteAlerts } from "@/hooks/use-escalation-mute-alerts"

/** Mount once in WechatShell — toasts on new agent escalation mutes. */
export function EscalationMuteAlerts() {
  useEscalationMuteAlerts()
  return null
}
