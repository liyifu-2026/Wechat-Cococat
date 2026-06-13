import type { MouseEvent } from "react"
import {
  Brain,
  Inbox,
  LayoutGrid,
  Settings2,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { HealthDot } from "@/components/console/status-badge"
import { useStackHealth } from "@/hooks/use-stack-health"
import { useConsoleStore, type ConsoleModule } from "@/stores/console-store"
import { useInboxMuteStore } from "@/stores/inbox-mute-store"
import { useTranslation } from "react-i18next"
import type { ServiceHealth } from "@/lib/stack-status"
import logoImg from "@/assets/logo.jpg"

type RailModule = ConsoleModule

const MODULES: {
  id: RailModule
  icon: typeof LayoutGrid
  labelKey: string
}[] = [
  { id: "overview", icon: LayoutGrid, labelKey: "console.modules.overview" },
  { id: "inbox", icon: Inbox, labelKey: "console.modules.inbox" },
  { id: "brain", icon: Brain, labelKey: "console.modules.brain" },
  { id: "system", icon: Settings2, labelKey: "console.modules.system" },
]

export function ConsoleRail() {
  const { t } = useTranslation()
  const health = useStackHealth()
  const activeModule = useConsoleStore((s) => s.activeModule)
  const setActiveModule = useConsoleStore((s) => s.setActiveModule)
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const navigateSystem = useConsoleStore((s) => s.navigateSystem)
  const inboxMuteCount = useInboxMuteStore((s) => s.mutes.length)

  const railActive: RailModule = activeModule

  function moduleHealth(id: RailModule): ServiceHealth | null {
    switch (id) {
      case "inbox":
        if (health.driver !== "up") return health.driver
        if (!health.wechatLoggedIn) return "degraded"
        return health.chatsReady ? "up" : "degraded"
      case "brain":
        return health.agent
      case "system":
        if (
          health.driver === "down" &&
          health.agent === "down" &&
          health.memory === "down"
        ) {
          return "down"
        }
        if (health.driver === "up" && health.agent === "up") return "up"
        return "degraded"
      default:
        return null
    }
  }

  function healthHint(id: RailModule, dot: ServiceHealth): string {
    if (id === "inbox") {
      if (health.driver !== "up") return t("console.rail.healthWechatDriver")
      if (!health.wechatLoggedIn) return t("console.rail.healthWechatLogin")
      if (!health.chatsReady) return t("console.rail.healthWechatDb")
    }
    if (id === "brain" && dot === "down") return t("console.rail.healthAgent")
    if (id === "system" && dot !== "up") return t("console.rail.healthStack")
    return t(`console.status.${dot}`)
  }

  function handleHealthClick(
    e: MouseEvent,
    id: RailModule,
    dot: ServiceHealth,
  ) {
    e.stopPropagation()
    if (dot === "up" || dot === "unknown") return
    switch (id) {
      case "inbox":
        navigateSystemWechat()
        break
      case "brain":
        navigateSystem("services", "agent")
        break
      case "system":
        navigateSystem("services", "driver")
        break
      default:
        break
    }
  }

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full w-12 shrink-0 flex-col items-center rounded-md border bg-card py-2">
        <div className="mb-2 flex items-center justify-center">
          <img
            src={logoImg}
            alt="CocoCat"
            className="h-8 w-8 rounded-[22%]"
          />
        </div>
        <div className="flex flex-1 flex-col items-center gap-1">
          {MODULES.map(({ id, icon: Icon, labelKey }) => {
            const dot = moduleHealth(id)
            const showHealthAction = dot && dot !== "up" && dot !== "unknown"
            const showTodoBadge = id === "inbox" && inboxMuteCount > 0
            return (
              <Tooltip key={id}>
                <div className="relative">
                  <TooltipTrigger
                    onClick={() => {
                      setActiveModule(id)
                      if (id === "inbox" && inboxMuteCount > 0) {
                        navigateInbox("chats", "todo")
                      }
                    }}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                      railActive === id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {dot && !showHealthAction && <HealthDot health={dot} />}
                  </TooltipTrigger>
                  {showTodoBadge && (
                    <span
                      className="absolute bottom-0.5 right-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold leading-none text-white"
                      aria-hidden
                    >
                      {inboxMuteCount > 9 ? "9+" : inboxMuteCount}
                    </span>
                  )}
                  {dot && showHealthAction && (
                    <button
                      type="button"
                      className="absolute -right-0.5 -top-0.5 z-10 flex h-3 w-3 items-center justify-center"
                      aria-label={healthHint(id, dot)}
                      onClick={(e) => handleHealthClick(e, id, dot)}
                    >
                      <HealthDot
                        health={dot}
                        className="static right-auto top-auto ring-0"
                      />
                    </button>
                  )}
                </div>
                <TooltipContent side="right">
                  {t(labelKey)}
                  {showTodoBadge
                    ? ` — ${t("console.rail.inboxTodo", { count: inboxMuteCount })}`
                    : ""}
                  {!showTodoBadge && dot && dot !== "up"
                    ? ` — ${healthHint(id, dot)}`
                    : ""}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
