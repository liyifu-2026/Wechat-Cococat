import { useTranslation } from "react-i18next"
import { AgentEscalationTab } from "@/components/console/agent-escalation-tab"
import { useConsoleStore } from "@/stores/console-store"

export function BrainRoutingTab() {
  const { t } = useTranslation()
  const navigateSystemAdvanced = useConsoleStore((s) => s.navigateSystemAdvanced)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-6 mt-4 space-y-3">
        <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">
            {t("console.brain.agentRuntimeTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("console.brain.agentRuntimeHint")}
          </p>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => navigateSystemAdvanced("agent")}
          >
            {t("console.brain.openAdvancedAgent")}
          </button>
        </div>
        <details className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground">
            {t("console.brain.groupBridgePaused")}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("console.brain.groupBridgeHint")}
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-foreground underline-offset-2 hover:underline"
            onClick={() => navigateSystemAdvanced("bridge")}
          >
            {t("console.brain.openAdvancedBridge")}
          </button>
        </details>
      </div>
      <AgentEscalationTab />
    </div>
  )
}
