import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { BrainModule } from "@/components/console/brain-module"
import { SettingsModule } from "@/components/console/settings-module"
import type { SettingsCategoryId } from "@/components/settings/settings-view"
import { useDraggableDialog } from "@/hooks/use-draggable-dialog"
import { useWechatDialogPortal } from "@/hooks/use-wechat-dialog-portal"
import {
  type WechatSettingsGroup,
  type WechatSettingsTab,
  brainTabFromSettingsTab,
  normalizeWechatSettingsTab,
} from "@/lib/console-layout"
import { useConsoleStore } from "@/stores/console-store"
import { cn } from "@/lib/utils"
import { WechatVncNavButton } from "@/components/wechat/wechat-vnc-nav-button"
import { CustomerTypesSection } from "@/components/settings/customer-types-section"

const LlmConfigView = lazy(() =>
  import("@/components/settings/llm-config/llm-config-view").then((m) => ({
    default: m.LlmConfigView,
  })),
)

type NavItem = {
  id: WechatSettingsTab
  labelKey: string
  group: WechatSettingsGroup
}

const SETTINGS_NAV: NavItem[] = [
  { id: "llm-config", labelKey: "settings.categories.llmConfig", group: "ai-settings" },
  { id: "embedding", labelKey: "settings.categories.embedding", group: "ai-settings" },
  { id: "web-search", labelKey: "settings.categories.webSearch", group: "ai-settings" },
  { id: "brain-persona", labelKey: "console.brain.tabs.persona", group: "wechat-ops" },
  { id: "brain-routing", labelKey: "console.brain.tabs.routing", group: "wechat-ops" },
  { id: "customer-types", labelKey: "wechat.customerTypes.nav", group: "wechat-ops" },
  { id: "about", labelKey: "settings.categories.about", group: "system-advanced" },
]

const GROUP_LABELS: Record<WechatSettingsGroup, string> = {
  "ai-settings": "wechat.settings.groupAi",
  "wechat-ops": "wechat.settings.groupWechat",
  "system-advanced": "wechat.settings.groupSystem",
}

function brainTabForSettings(tab: WechatSettingsTab) {
  return brainTabFromSettingsTab(tab)
}

function settingsCategoryForTab(
  tab: WechatSettingsTab,
): SettingsCategoryId | null {
  if (tab.startsWith("brain-")) return null
  if (tab === "llm-config") return null
  if (tab === "embedding" || tab === "web-search" || tab === "about") {
    return tab
  }
  return null
}

function SettingsTabContent({ tab }: { tab: WechatSettingsTab }) {
  const { t } = useTranslation()
  const brainTab = brainTabForSettings(tab)

  if (tab === "customer-types") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <CustomerTypesSection />
      </div>
    )
  }

  if (tab === "llm-config") {
    return (
      <Suspense
        fallback={
          <div className="p-8 text-sm text-[var(--wx-muted)]">
            {t("settings.sections.llmConfig.loading")}
          </div>
        }
      >
        <div className="wechat-settings-scroll min-h-0 flex-1 overflow-y-auto p-8">
          <LlmConfigView embedded />
        </div>
      </Suspense>
    )
  }

  if (brainTab) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <BrainModule embedded forcedTab={brainTab} hideTabs />
      </div>
    )
  }

  const category = settingsCategoryForTab(tab)
  if (category) {
    return (
      <SettingsModule
        embedded
        hideHeader
        hideSidebar
        hideGroupTabs
        forcedCategory={category}
      />
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--wx-muted)]">
      {t("wechat.settings.unavailable")}
    </div>
  )
}

export function WechatSettingsModal() {
  const { t } = useTranslation()
  const open = useConsoleStore((s) => s.settingsModalOpen)
  const rawTab = useConsoleStore((s) => s.settingsModalTab)
  const tab = normalizeWechatSettingsTab(rawTab)
  const openSettingsModal = useConsoleStore((s) => s.openSettingsModal)
  const closeSettingsModal = useConsoleStore((s) => s.closeSettingsModal)
  const { contentRef, dragHandleProps, contentStyle } = useDraggableDialog(open)
  const portalContainer = useWechatDialogPortal(open)

  const activeItem = SETTINGS_NAV.find((item) => item.id === tab) ?? SETTINGS_NAV[0]!
  const activeLabel = t(activeItem.labelKey)

  let lastGroup: WechatSettingsGroup | null = null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSettingsModal()
      }}
    >
      <DialogContent
        ref={contentRef}
        style={contentStyle}
        showCloseButton
        opaqueOverlay
        portalContainer={portalContainer}
        overlayClassName="wechat-settings-scrim"
        className="wechat-settings-dialog left-1/2 top-1/2 flex h-[min(760px,88vh)] max-w-5xl translate-none flex-col gap-0 overflow-hidden border border-[var(--wx-border)] bg-[var(--wx-header-bg)] p-0 text-[var(--wx-text)] shadow-2xl sm:max-w-5xl"
      >
        <DialogTitle className="sr-only">{t("wechat.settings.title")}</DialogTitle>

        <header
          className="flex shrink-0 cursor-grab items-center border-b border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-6 py-4 active:cursor-grabbing"
          {...dragHandleProps}
        >
          <h2 className="text-base font-medium">{t("wechat.settings.title")}</h2>
          <span className="mx-3 text-[var(--wx-muted)]">/</span>
          <span className="text-sm text-[var(--wx-muted)]">{activeLabel}</span>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-52 shrink-0 flex-col border-r border-[var(--wx-border)] bg-[var(--wx-list-bg)] py-3 min-h-0">
            <div className="wechat-settings-scroll min-h-0 flex-1 overflow-y-auto">
            {SETTINGS_NAV.map((item) => {
              const showGroupHeader = item.group !== lastGroup
              lastGroup = item.group
              return (
                <div key={item.id}>
                  {showGroupHeader && (
                    <p className="mb-1 mt-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-[var(--wx-muted)] first:mt-0">
                      {t(GROUP_LABELS[item.group])}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      openSettingsModal({ group: item.group, tab: item.id })
                    }
                    className={cn(
                      "mx-2 block w-[calc(100%-1rem)] rounded-md px-3 py-2 text-left text-sm transition-colors",
                      tab === item.id
                        ? "bg-[var(--wx-list-active)] font-medium text-[var(--wx-text)]"
                        : "text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]",
                    )}
                  >
                    {t(item.labelKey)}
                  </button>
                </div>
              )
            })}
            </div>
            <div className="mt-auto shrink-0 border-t border-[var(--wx-border)] pt-2">
              <WechatVncNavButton />
            </div>
          </nav>

          <div className="wechat-settings-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wx-header-bg)]">
            <SettingsTabContent tab={tab} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
