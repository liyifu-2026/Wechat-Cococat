import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useConsoleStore } from "@/stores/console-store"
import { AgentBridgePanel } from "@/components/console/agent-bridge-panel"
import { AgentRuntimePanel } from "@/components/console/agent-runtime-panel"
import { MemoryModule } from "@/components/console/memory-module"
import { ModuleTabs } from "@/components/console/module-tabs"
import { SettingsModule } from "@/components/console/settings-module"
import { useModuleTab } from "@/hooks/use-module-tab"
import {
  LAYOUT_KEYS,
  SYSTEM_ADVANCED_TABS,
  type SystemAdvancedTab,
} from "@/lib/console-layout"

export function SystemAdvancedPanel() {
  const { t } = useTranslation()
  const consumePendingSystemAdvancedTab = useConsoleStore(
    (s) => s.consumePendingSystemAdvancedTab,
  )
  const pendingTab = consumePendingSystemAdvancedTab()

  const [activeTab, setActiveTab] = useModuleTab<SystemAdvancedTab>({
    storageKey: LAYOUT_KEYS.systemAdvancedTab,
    allowed: SYSTEM_ADVANCED_TABS,
    defaultTab: "interface",
  })

  useEffect(() => {
    if (pendingTab && pendingTab !== activeTab) {
      setActiveTab(pendingTab)
    }
  }, [pendingTab, activeTab, setActiveTab])

  const tabs = SYSTEM_ADVANCED_TABS.map((id) => ({
    id,
    label: t(`console.system.advanced.tabs.${id}`),
  }))

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-8 py-3">
        <ModuleTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "interface" && (
          <SettingsModule embedded lockedGroup="system" hideHeader />
        )}
        {activeTab === "memory" && <MemoryModule embedded />}
        {activeTab === "bridge" && <AgentBridgePanel embedded />}
        {activeTab === "agent" && <AgentRuntimePanel embedded />}
      </div>
    </div>
  )
}
