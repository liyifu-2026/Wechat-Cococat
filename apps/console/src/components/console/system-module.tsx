import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { SettingsModule } from "@/components/console/settings-module"
import { StackModule } from "@/components/console/stack-module"
import { SystemAdvancedPanel } from "@/components/console/system-advanced-panel"
import { SystemSidebar } from "@/components/console/system-sidebar"
import { SystemKnowledgePanel } from "@/components/console/system-knowledge-panel"
import { useModuleTab } from "@/hooks/use-module-tab"
import {
  LAYOUT_KEYS,
  SYSTEM_PANELS,
  type SystemPanel,
} from "@/lib/console-layout"
import { useConsoleStore } from "@/stores/console-store"

export function SystemModule() {
  const { t } = useTranslation()
  const consumePendingSystemPanel = useConsoleStore(
    (s) => s.consumePendingSystemPanel,
  )
  const consumePendingSettingsNavigation = useConsoleStore(
    (s) => s.consumePendingSettingsNavigation,
  )
  const pendingPanel = consumePendingSystemPanel()
  const pendingSettings = consumePendingSettingsNavigation()

  const [panel, setPanel] = useModuleTab<SystemPanel>({
    storageKey: LAYOUT_KEYS.systemPanel,
    allowed: SYSTEM_PANELS,
    defaultTab: "services",
  })

  useEffect(() => {
    if (pendingSettings.group === "wiki") {
      setPanel("wikiModels")
    } else if (pendingSettings.group) {
      setPanel("program")
    } else if (pendingPanel) {
      setPanel(pendingPanel)
    }
  }, [pendingPanel, pendingSettings.group, setPanel])

  return (
    <div className="flex h-full min-h-0">
      <SystemSidebar active={panel} onChange={setPanel} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {panel !== "program" && panel !== "knowledge" && (
          <header className="shrink-0 border-b px-8 py-5">
            <h1 className="text-lg font-semibold">
              {t(`console.system.panels.${panel}`)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`console.system.panelDesc.${panel}`)}
            </p>
          </header>
        )}
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {panel === "services" && (
            <StackModule embedded forcedTab="service" />
          )}
          {panel === "logs" && <StackModule embedded forcedTab="logs" />}
          {panel === "program" && (
            <SettingsModule embedded lockedGroup="cococat" />
          )}
          {panel === "wikiModels" && (
            <SettingsModule embedded lockedGroup="wiki" hideHeader />
          )}
          {panel === "knowledge" && <SystemKnowledgePanel />}
          {panel === "advanced" && <SystemAdvancedPanel />}
        </div>
      </div>
    </div>
  )
}
