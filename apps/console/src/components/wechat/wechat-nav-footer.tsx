import { useEffect, useState } from "react"
import { Moon, Settings2, Sparkles, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { InboxAiBubbleConnector } from "@/components/wechat/inbox-ai-bubble-connector"
import { InboxAiLiquidGlass } from "@/components/wechat/inbox-ai-liquid-glass"
import { INBOX_AI_TRIGGER_WRAP_ID } from "@/lib/inbox-ai-hosts"
import { isDarkRendered, toggleLightDarkTheme } from "@/lib/theme"
import { useConsoleStore } from "@/stores/console-store"
import { isAiAssistPanelOpen, useAiAssistStore } from "@/stores/ai-assist-store"

export function WechatNavFooter() {
  const { t } = useTranslation()
  const openSettingsModal = useConsoleStore((s) => s.openSettingsModal)
  const settingsOpen = useConsoleStore((s) => s.settingsModalOpen)
  const boundInboxChatId = useAiAssistStore((s) => s.boundInboxChatId)
  const aiAssistLayer = useAiAssistStore((s) => s.layer)
  const togglePanel = useAiAssistStore((s) => s.togglePanel)
  const aiAssistOpen = isAiAssistPanelOpen(aiAssistLayer)
  const activeWechatTab = useConsoleStore((s) => s.activeWechatTab)
  const [dark, setDark] = useState(isDarkRendered)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains("dark"))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  const navBtn =
    "flex h-11 w-11 items-center justify-center rounded-xl text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
  const navBtnActive =
    "bg-[var(--wechat-brand-muted)] text-[var(--wechat-brand)]"
  const aiAssistBtn = `${navBtn} relative text-emerald-400 hover:text-emerald-300`

  return (
    <div className="flex flex-col items-center gap-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          onClick={() => toggleLightDarkTheme()}
          className={navBtn}
          aria-label={
            dark ? t("wechat.nav.themeLight") : t("wechat.nav.themeDark")
          }
        >
          {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </TooltipTrigger>
        <TooltipContent side="right">
          {dark ? t("wechat.nav.themeLight") : t("wechat.nav.themeDark")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          onClick={() => openSettingsModal()}
          className={`${navBtn} ${settingsOpen ? navBtnActive : ""}`}
          aria-label={t("wechat.nav.settings")}
        >
          <Settings2 className="h-5 w-5" />
        </TooltipTrigger>
        <TooltipContent side="right">{t("wechat.nav.settings")}</TooltipContent>
      </Tooltip>

      {activeWechatTab === "chats" && boundInboxChatId && (
        <>
          <InboxAiBubbleConnector open={aiAssistOpen} />
          <Tooltip>
            <TooltipTrigger
              onClick={() => togglePanel()}
              className={`${aiAssistBtn} ${aiAssistOpen ? "text-emerald-300" : ""}`}
              aria-label={t("wechat.aiAssist.title")}
              aria-pressed={aiAssistOpen}
            >
              <div
                id={INBOX_AI_TRIGGER_WRAP_ID}
                className={`inbox-ai-trigger-wrap ${aiAssistOpen ? "inbox-ai-trigger-wrap--open" : ""}`}
              >
                <InboxAiLiquidGlass
                  variant="trigger"
                  className="inbox-ai-trigger-bubble"
                >
                  <span className="sr-only">{t("wechat.aiAssist.title")}</span>
                </InboxAiLiquidGlass>
                <Sparkles className="relative z-[3] h-5 w-5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("wechat.aiAssist.title")}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}
