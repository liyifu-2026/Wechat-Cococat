import { useEffect, useState } from "react"
import { Inbox } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/console/status-badge"
import { readConfigFile } from "@/lib/agent-config-client"
import { parseEscalationConfig } from "@/lib/escalation-config"
import { useStackHealth } from "@/hooks/use-stack-health"
import { useConsoleStore } from "@/stores/console-store"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"

export function ConsoleTopbar() {
  const { t } = useTranslation()
  const health = useStackHealth()
  const inboxMuteCount = useInboxMuteStore((s) => s.mutes.length)
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const [maintainerName, setMaintainerName] = useState("")

  useEffect(() => {
    void readConfigFile("escalation.json")
      .then((raw) => {
        const cfg = parseEscalationConfig(raw)
        setMaintainerName(cfg.maintainer.displayName.trim())
      })
      .catch(() => setMaintainerName(""))
  }, [])

  const canServe =
    health.driver === "up" &&
    health.wechatLoggedIn &&
    health.chatsReady &&
    health.agent === "up"

  const statusHealth = !canServe
    ? health.driver !== "up"
      ? health.driver
      : !health.wechatLoggedIn
        ? "degraded"
        : !health.chatsReady
          ? "degraded"
          : health.agent
    : "up"

  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
      <StatusBadge
        label={
          canServe
            ? t("console.topbar.ready")
            : t("console.topbar.notReady")
        }
        health={statusHealth}
      />
      {maintainerName ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t("console.topbar.maintainer", { name: maintainerName })}
        </span>
      ) : null}
      <div className="min-w-0 flex-1" />
      {inboxMuteCount > 0 ? (
        <Button
          size="sm"
          variant="default"
          className="shrink-0"
          onClick={() => navigateInbox("chats", "todo")}
        >
          <Inbox className="mr-1.5 h-3.5 w-3.5" />
          {t("console.topbar.handleTodo", { count: inboxMuteCount })}
        </Button>
      ) : null}
      <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
        ⌘K
      </kbd>
    </header>
  )
}
