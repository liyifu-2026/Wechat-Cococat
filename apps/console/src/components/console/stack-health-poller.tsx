import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"
import { refreshStackHealth } from "@/hooks/use-stack-health"

/** Global stack health poll loop — gated when tab is hidden. */
export function StackHealthPoller() {
  useVisibilityGatedInterval(() => void refreshStackHealth(), 12_000, {
    suspendWhenHidden: true,
  })
  return null
}
