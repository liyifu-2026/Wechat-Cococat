import { useKbAttentionAlerts } from "@/hooks/use-kb-attention-alerts"

/** Mount once in WechatShell — toasts when KB review/lint pending grows. */
export function KbAttentionAlerts() {
  useKbAttentionAlerts()
  return null
}
