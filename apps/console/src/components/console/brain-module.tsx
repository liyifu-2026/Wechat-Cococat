import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { BrainPersonaTab } from "@/components/console/brain-persona-tab"
import { BrainWikiPanel } from "@/components/console/brain-wiki-panel"
import { BrainRoutingTab } from "@/components/console/brain-routing-tab"
import { BrainTryAskPanel } from "@/components/console/brain-try-ask-panel"
import { ModuleTabs } from "@/components/console/module-tabs"
import { useModuleTab } from "@/hooks/use-module-tab"
import {
  BRAIN_TABS,
  LAYOUT_KEYS,
  type BrainTab,
} from "@/lib/console-layout"
import { useConsoleStore } from "@/stores/console-store"

export function BrainModule() {
  const { t } = useTranslation()
  const consumePendingBrainTab = useConsoleStore((s) => s.consumePendingBrainTab)
  const setBrainTab = useConsoleStore((s) => s.setBrainTab)
  const pending = consumePendingBrainTab()

  const [activeTab, setActiveTab] = useModuleTab<BrainTab>({
    storageKey: LAYOUT_KEYS.brainTab,
    allowed: BRAIN_TABS,
    defaultTab: "persona",
    forcedTab: null,
  })

  useEffect(() => {
    if (pending && pending !== activeTab) {
      setActiveTab(pending)
      setBrainTab(pending)
    }
  }, [pending, activeTab, setActiveTab, setBrainTab])

  const tabs = BRAIN_TABS.map((id) => ({
    id,
    label: t(`console.brain.tabs.${id}`),
  }))

  const showTryAsk = activeTab === "persona" || activeTab === "routing"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-2">
        <div className="mb-1">
          <h1 className="text-lg font-semibold">{t("console.brain.title")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("console.brain.subtitle")}
          </p>
        </div>
        <ModuleTabs
          tabs={tabs}
          active={activeTab}
          onChange={(tab) => {
            setActiveTab(tab)
            setBrainTab(tab)
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {activeTab === "persona" && <BrainPersonaTab />}
          {activeTab === "routing" && <BrainRoutingTab />}
          {activeTab === "kb" && <BrainWikiPanel />}
        </div>
        {showTryAsk && <BrainTryAskPanel />}
      </div>
    </div>
  )
}
