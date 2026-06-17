import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import { isTodoMuteEntry } from "@/lib/inbox-mute-badges"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"
import { useMaintainers } from "@/hooks/use-maintainers"
import { useContactCache } from "@/hooks/use-contact-cache"
import { useToastStore } from "@/stores/toast-store"

function muteAlertKey(entry: EscalationMuteEntry): string {
  return `${entry.chat_id}:${entry.triggered_at}:${entry.reason}`
}

function isMaintainerAlertReason(reason: string): boolean {
  return (
    reason === "escalate_a" ||
    reason === "escalate" ||
    reason === "probe_b" ||
    reason === "probe_loop"
  )
}

/** Toast when new agent escalation mutes appear; highlight if viewer is a maintainer. */
export function useEscalationMuteAlerts(): void {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const mutes = useInboxMuteStore((s) => s.mutes)
  const { isMaintainer } = useMaintainers()
  const contacts = useContactCache()
  const seenRef = useRef<Set<string>>(new Set())
  const bootRef = useRef(true)

  useEffect(() => {
    const loggedIn = contacts.loggedInUser?.trim()
    const viewerIsMaintainer = Boolean(
      loggedIn && isMaintainer(loggedIn),
    )

    if (bootRef.current) {
      bootRef.current = false
      for (const entry of mutes) {
        seenRef.current.add(muteAlertKey(entry))
      }
      return
    }

    for (const entry of mutes) {
      const key = muteAlertKey(entry)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      if (!isMaintainerAlertReason(entry.reason)) continue

      const chatLabel = entry.chat_name?.trim() || entry.chat_id
      if (viewerIsMaintainer) {
        addToast(
          t("wechat.inbox.maintainerEscalationToast", { chat: chatLabel }),
          "error",
        )
      } else {
        addToast(
          t("wechat.inbox.escalationMuteToast", { chat: chatLabel }),
          "info",
        )
      }
    }
  }, [addToast, contacts.loggedInUser, isMaintainer, mutes, t])
}

export function isEscalationMuteEntry(entry: EscalationMuteEntry): boolean {
  return isTodoMuteEntry(entry) || entry.reason === "probe_b"
}
