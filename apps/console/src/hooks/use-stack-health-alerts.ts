import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  useStackHealth,
  type StackHealthSnapshot,
} from "@/hooks/use-stack-health"
import {
  notifyStackAlert,
  shouldSendStackNotification,
} from "@/lib/stack-notifications"
import { useToastStore } from "@/stores/toast-store"
import type { ServiceHealth } from "@/lib/stack-status"

function isStable(health: ServiceHealth): boolean {
  return health === "up" || health === "down" || health === "degraded"
}

/** True only on a real from→to transition (ignores unknown / first poll noise). */
function transitioned(
  prev: ServiceHealth,
  next: ServiceHealth,
  from: ServiceHealth,
  to: ServiceHealth,
): boolean {
  if (!isStable(prev) || !isStable(next)) return false
  return prev === from && next === to
}

function maybeNotify(title: string, body: string) {
  if (shouldSendStackNotification()) {
    void notifyStackAlert(title, body)
  }
}

function alertOnChanges(
  prev: StackHealthSnapshot,
  next: StackHealthSnapshot,
  addToast: (msg: string, type?: "success" | "error" | "info") => void,
  t: (key: string) => string,
) {
  if (prev.loading || next.loading) return
  if (!isStable(prev.driver) || !isStable(prev.agent) || !isStable(prev.memory)) {
    return
  }

  if (transitioned(prev.driver, next.driver, "up", "down")) {
    const msg = t("console.alerts.driverDown")
    addToast(msg, "error")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  } else if (transitioned(prev.driver, next.driver, "down", "up")) {
    const msg = t("console.alerts.driverUp")
    addToast(msg, "success")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  }

  if (transitioned(prev.agent, next.agent, "up", "down")) {
    const msg = t("console.alerts.agentDown")
    addToast(msg, "error")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  } else if (transitioned(prev.agent, next.agent, "down", "up")) {
    const msg = t("console.alerts.agentUp")
    addToast(msg, "success")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  }

  if (transitioned(prev.memory, next.memory, "up", "down")) {
    const msg = t("console.alerts.memoryDown")
    addToast(msg, "error")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  } else if (transitioned(prev.memory, next.memory, "down", "up")) {
    const msg = t("console.alerts.memoryUp")
    addToast(msg, "success")
    maybeNotify(t("console.alerts.notifyTitle"), msg)
  }

  if (prev.driver === "up" && next.driver === "up") {
    if (prev.wechatLoggedIn && !next.wechatLoggedIn) {
      const msg = t("console.alerts.wechatLoggedOut")
      addToast(msg, "error")
      maybeNotify(t("console.alerts.notifyTitle"), msg)
    } else if (!prev.wechatLoggedIn && next.wechatLoggedIn) {
      const msg = t("console.alerts.wechatLoggedIn")
      addToast(msg, "success")
      maybeNotify(t("console.alerts.notifyTitle"), msg)
    }
  }
}

/**
 * Toast (+ optional system notification) when stack / WeChat health changes.
 */
export function useStackHealthAlerts(): void {
  const { t } = useTranslation()
  const health = useStackHealth()
  const addToast = useToastStore((s) => s.addToast)
  const prevRef = useRef<StackHealthSnapshot | null>(null)

  useEffect(() => {
    const prev = prevRef.current
    if (prev) {
      alertOnChanges(prev, health, addToast, t)
    }
    prevRef.current = health
  }, [health, addToast, t])
}
