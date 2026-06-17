import { useState } from "react"
import { Bot, Hand } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { useAgentProxy } from "@/hooks/use-agent-proxy"
import { cn } from "@/lib/utils"

type AgentProxyState = ReturnType<typeof useAgentProxy>

interface AgentProxyToggleProps {
  proxy: AgentProxyState
  /** 私聊才显示可操作开关；群聊仅展示说明 */
  isGroup?: boolean
  variant?: "panel" | "topbar"
}

export function AgentProxyToggle({
  proxy,
  isGroup = false,
  variant = "panel",
}: AgentProxyToggleProps) {
  const { t } = useTranslation()
  const [confirmOff, setConfirmOff] = useState(false)

  async function handleToggle() {
    if (proxy.agentProxyEnabled) {
      if (!confirmOff) {
        setConfirmOff(true)
        return
      }
      setConfirmOff(false)
      await proxy.setAgentProxyEnabled(false)
      return
    }
    setConfirmOff(false)
    await proxy.setAgentProxyEnabled(true)
  }

  if (proxy.loading) {
    return (
      <p
        className={cn(
          "text-xs text-muted-foreground",
          variant === "panel" ? "mt-3" : "",
        )}
      >
        {t("wechat.inbox.agentProxyLoading")}
      </p>
    )
  }

  if (isGroup) {
    const hint = t("wechat.inbox.agentProxyGroupHint")
    if (variant === "topbar") {
      return (
        <span
          className="max-w-[140px] truncate text-[11px] text-[var(--wx-muted)]"
          title={hint}
        >
          {t("wechat.inbox.agentProxyGroupShort")}
        </span>
      )
    }
    return <p className="mt-3 text-xs text-muted-foreground">{hint}</p>
  }

  if (variant === "topbar") {
    const on = proxy.agentProxyEnabled
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              on
                ? "border-[var(--wechat-brand)]/40 bg-[var(--wechat-brand)]/10 text-[var(--wechat-brand)]"
                : "border-[var(--wx-border)] bg-[var(--wx-search-input)] text-[var(--wx-muted)]",
            )}
          >
            {on ? (
              <Bot className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Hand className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {on
              ? t("wechat.inbox.agentProxyTopbarOn")
              : t("wechat.inbox.agentProxyTopbarOff")}
          </span>
          <Button
            size="sm"
            variant={on ? "default" : "outline"}
            className="h-7 shrink-0 px-2.5 text-[11px]"
            disabled={proxy.busy}
            onClick={() => void handleToggle()}
          >
            {proxy.busy
              ? t("wechat.inbox.agentProxySaving")
              : on
                ? confirmOff
                  ? t("wechat.inbox.agentProxyConfirmOff")
                  : t("wechat.inbox.agentProxyTurnOff")
                : t("wechat.inbox.agentProxyTurnOn")}
          </Button>
        </div>
        {proxy.error && (
          <p className="max-w-[220px] text-right text-[10px] text-destructive">
            {proxy.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {t("wechat.inbox.agentProxyTitle")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {proxy.agentProxyEnabled
              ? t("wechat.inbox.agentProxyOnHint")
              : t("wechat.inbox.agentProxyOffHint")}
          </p>
        </div>
        <Button
          size="sm"
          variant={proxy.agentProxyEnabled ? "default" : "outline"}
          className="h-7 shrink-0 text-xs"
          disabled={proxy.busy}
          onClick={() => void handleToggle()}
        >
          {proxy.busy
            ? t("wechat.inbox.agentProxySaving")
            : proxy.agentProxyEnabled
              ? confirmOff
                ? t("wechat.inbox.agentProxyConfirmOff")
                : t("wechat.inbox.agentProxyTurnOff")
              : t("wechat.inbox.agentProxyTurnOn")}
        </Button>
      </div>
      {proxy.error && (
        <p className="mt-2 text-[11px] text-destructive">{proxy.error}</p>
      )}
    </div>
  )
}
