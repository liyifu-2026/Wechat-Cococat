import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { BrainPersonaTab } from "@/components/console/brain-persona-tab"
import { BrainWikiPanel } from "@/components/console/brain-wiki-panel"
import { BrainRoutingTab } from "@/components/console/brain-routing-tab"
import { ModuleTabs } from "@/components/console/module-tabs"
import { useModuleTab } from "@/hooks/use-module-tab"
import {
  BRAIN_TABS,
  LAYOUT_KEYS,
  type BrainTab,
} from "@/lib/console-layout"
import { useConsoleStore } from "@/stores/console-store"

type BrainModuleProps = {
  /** AI 实验室内嵌：去掉重复标题与试跑侧栏 */
  embedded?: boolean
  /** 设置 Modal 单页模式：锁定子 Tab */
  forcedTab?: BrainTab | null
  /** 设置 Modal 单页模式：隐藏 Tab 栏 */
  hideTabs?: boolean
}

export function BrainModule({
  embedded = false,
  forcedTab = null,
  hideTabs = false,
}: BrainModuleProps) {
  const { t } = useTranslation()
  const pendingBrainTab = useConsoleStore((s) => s.pendingBrainTab)
  const consumePendingBrainTab = useConsoleStore((s) => s.consumePendingBrainTab)
  const setBrainTab = useConsoleStore((s) => s.setBrainTab)

  const [activeTab, setActiveTab] = useModuleTab<BrainTab>({
    storageKey: LAYOUT_KEYS.brainTab,
    allowed: BRAIN_TABS,
    defaultTab: "persona",
    forcedTab: forcedTab ?? null,
  })

  useEffect(() => {
    const pending = consumePendingBrainTab()
    if (pending && pending !== activeTab) {
      setActiveTab(pending)
      setBrainTab(pending)
    }
  }, [pendingBrainTab, activeTab, consumePendingBrainTab, setActiveTab, setBrainTab])

  const tabs = BRAIN_TABS.map((id) => ({
    id,
    label: t(`console.brain.tabs.${id}`),
  }))

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wechat-dark-panel)] text-[var(--wx-text)]">
      {!hideTabs && (
        <div
          className={
            embedded
              ? "shrink-0 border-b border-[var(--wx-border)] px-4 py-2"
              : "shrink-0 border-b px-4 py-2"
          }
        >
          {!embedded && (
            <div className="mb-1">
              <h1 className="text-lg font-semibold">{t("console.brain.title")}</h1>
              <p className="text-xs text-muted-foreground">
                {t("console.brain.subtitle")}
              </p>
            </div>
          )}
          <ModuleTabs
            tabs={tabs}
            active={activeTab}
            onChange={(tab) => {
              setActiveTab(tab)
              setBrainTab(tab)
            }}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "persona" && <BrainPersonaTab />}
        {activeTab === "routing" && <BrainRoutingTab />}
        {activeTab === "kb" && <BrainWikiPanel />}
      </div>
    </div>
  )
}
