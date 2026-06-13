import { useStackHealthAlerts } from "@/hooks/use-stack-health-alerts"

/** Mount once in ConsoleShell — shows toasts on stack health transitions. */
export function StackHealthAlerts() {
  useStackHealthAlerts()
  return null
}
