import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"

const POLL_MS = 15_000

/** 全局 mute 轮询 — ConsoleShell 挂载一次，供侧栏角标与收件箱共用 */
export function InboxMutePoller() {
  const refreshMutes = useInboxMuteStore((s) => s.refreshMutes)

  useVisibilityGatedInterval(() => void refreshMutes(), POLL_MS, {
    allowedModules: ["inbox", "overview"],
    degradedIntervalMs: 60_000,
    suspendWhenHidden: true,
  })

  return null
}
