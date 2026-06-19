import { useCallback, useMemo } from "react"
import type { MouseEvent } from "react"
import { MessageCircle, Users, BookOpen } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HealthDot } from "@/components/console/status-badge"
import { WechatNavFooter } from "@/components/wechat/wechat-nav-footer"
import { useKbAttentionCount } from "@/hooks/use-kb-attention-alerts"
import { useStackHealth } from "@/hooks/use-stack-health"
import { isTauri, toggleMaximizeWindow } from "@/lib/tauri-window"
import { useConsoleStore, type WechatShellTab } from "@/stores/console-store"
import {
  countInboxAttentionChats,
  useInboxUnreadStore,
} from "@/stores/inbox-unread-store"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"
import type { ServiceHealth } from "@/lib/stack-status"
import logoImg from "@/assets/logo.jpg"

const TABS: {
  id: WechatShellTab
  icon: typeof MessageCircle
  labelKey: string
}[] = [
  { id: "chats", icon: MessageCircle, labelKey: "wechat.nav.chats" },
  { id: "contacts", icon: Users, labelKey: "wechat.nav.contacts" },
  { id: "kb", icon: BookOpen, labelKey: "wechat.nav.knowledge" },
]

export function WechatNavRail() {
  const { t } = useTranslation()
  const health = useStackHealth()
  const activeWechatTab = useConsoleStore((s) => s.activeWechatTab)
  const setActiveWechatTab = useConsoleStore((s) => s.setActiveWechatTab)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const mutes = useInboxMuteStore((s) => s.mutes)
  const muteChatIds = useMemo(() => mutes.map((m) => m.chat_id), [mutes])
  const unreadCountsByChatId = useInboxUnreadStore(
    (s) => s.unreadCountsByChatId,
  )
  const nextUnreadChatId = useInboxUnreadStore((s) => s.nextUnreadChatId)
  const chatAttentionCount = countInboxAttentionChats(
    muteChatIds,
    unreadCountsByChatId,
  )
  const kbAttentionCount = useKbAttentionCount()

  function chatsHealth(): ServiceHealth | null {
    if (health.driver !== "up") return health.driver
    if (!health.wechatLoggedIn) return "degraded"
    return health.chatsReady ? "up" : "degraded"
  }

  function handleSelect(tab: WechatShellTab) {
    setActiveWechatTab(tab)
    if (tab === "chats") {
      navigateInbox("chats")
    }
  }

  function handleChatTabDoubleClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const chatId = nextUnreadChatId()
    if (chatId) {
      navigateInboxChat(chatId)
      return
    }
    handleSelect("chats")
  }

  function handleHealthClick(e: MouseEvent, dot: ServiceHealth) {
    e.stopPropagation()
    if (dot === "up" || dot === "unknown") return
    navigateSystemWechat()
  }

  const dot = chatsHealth()

  const handleTitlebarDoubleClick = useCallback(() => {
    if (!isTauri()) return
    void toggleMaximizeWindow()
  }, [])

  return (
    <TooltipProvider delay={300}>
      <nav className="wechat-nav-rail flex h-full w-[72px] shrink-0 flex-col items-center bg-[var(--wechat-nav-bg)] py-3">
        <div
          className="wechat-nav-titlebar mb-3 flex w-full flex-col items-center gap-0.5 px-1"
          data-tauri-drag-region={isTauri() ? true : undefined}
          onDoubleClick={handleTitlebarDoubleClick}
        >
          <img
            src={logoImg}
            alt="CocoCat"
            className="h-9 w-9 rounded-[22%]"
            draggable={false}
          />
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          {TABS.map(({ id, icon: Icon, labelKey }) => {
            const active = activeWechatTab === id
            const showChatBadge = id === "chats" && chatAttentionCount > 0
            const showKbBadge = id === "kb" && kbAttentionCount > 0
            const badgeCount =
              id === "chats" ? chatAttentionCount : kbAttentionCount
            const showTodoBadge = showChatBadge || showKbBadge
            const showHealth = id === "chats" && dot && dot !== "up"

            return (
              <Tooltip key={id}>
                <div className="relative">
                  <TooltipTrigger
                    onClick={() => handleSelect(id)}
                    onDoubleClick={
                      id === "chats" ? handleChatTabDoubleClick : undefined
                    }
                    className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                      active
                        ? "bg-[var(--wechat-brand-muted)] text-[var(--wechat-brand)]"
                        : "text-[var(--wx-muted)] hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </TooltipTrigger>
                  {showTodoBadge && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wx-warn-badge)] px-1 text-[10px] font-semibold text-white">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                  {showHealth && (
                    <button
                      type="button"
                      className="absolute -right-0.5 -top-0.5 z-10"
                      aria-label={t("wechat.nav.healthHint")}
                      onClick={(e) => handleHealthClick(e, dot!)}
                    >
                      <HealthDot health={dot!} className="static" />
                    </button>
                  )}
                </div>
                <TooltipContent side="right">{t(labelKey)}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <WechatNavFooter />
      </nav>
    </TooltipProvider>
  )
}
