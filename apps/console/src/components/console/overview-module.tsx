import { useEffect, useMemo, useState } from "react"
import { Inbox } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/console/status-badge"
import { useStackHealth } from "@/hooks/use-stack-health"
import { useInboxMutes } from "@/hooks/use-inbox-mutes"
import { useConsoleStore } from "@/stores/console-store"
import { useToastStore } from "@/stores/toast-store"
import { chatDisplayName } from "@/lib/wechat-ui"
import { fetchDriverChats } from "@/lib/driver-client"
import { OverviewAgentTrace } from "@/components/console/overview-agent-trace"
import { OverviewKbGaps } from "@/components/console/overview-kb-gaps"
import { OverviewTimeline } from "@/components/console/overview-timeline"
import { useConsoleEvents } from "@/hooks/use-console-events"

export function OverviewModule() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const health = useStackHealth()
  const { mutes, markAllDone, batchBusy } = useInboxMutes()
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const navigateSystem = useConsoleStore((s) => s.navigateSystem)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)

  const [traceOpen, setTraceOpen] = useState(false)
  const { events: consoleEvents, loading: eventsLoading, refresh } =
    useConsoleEvents(traceOpen ? 10_000 : 30_000, traceOpen ? 300 : 80)

  const [chatNames, setChatNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const ids = new Set<string>()
    for (const m of mutes) ids.add(m.chat_id)
    for (const ev of consoleEvents) {
      if (ev.chatId) ids.add(ev.chatId)
    }
    if (ids.size === 0) return
    void fetchDriverChats(80)
      .then((chats) => {
        const map: Record<string, string> = {}
        for (const c of chats) {
          map[c.id] = chatDisplayName(c)
        }
        setChatNames(map)
      })
      .catch(() => {})
  }, [mutes, consoleEvents])

  const canServe =
    health.driver === "up" &&
    health.wechatLoggedIn &&
    health.chatsReady &&
    health.agent === "up"

  const headline = canServe
    ? mutes.length > 0
      ? t("console.overview.readyWithTodo", { count: mutes.length })
      : t("console.overview.ready")
    : t("console.overview.notReady")

  const nextSteps = useMemo(() => {
    const steps: { key: string; text: string; action: () => void }[] = []
    if (health.driver !== "up") {
      steps.push({
        key: "driver",
        text: t("console.overview.stepDriver"),
        action: () => navigateSystem("services", "driver"),
      })
    } else if (!health.wechatLoggedIn) {
      steps.push({
        key: "wechat",
        text: t("console.overview.stepWechat"),
        action: () => navigateSystemWechat(),
      })
    } else if (!health.chatsReady) {
      steps.push({
        key: "wechat-db",
        text: t("console.overview.stepWechatDb"),
        action: () => navigateSystemWechat(true),
      })
    } else if (health.agent !== "up") {
      steps.push({
        key: "agent",
        text: t("console.overview.stepAgent"),
        action: () => navigateSystem("services", "agent"),
      })
    }
    for (const m of mutes.slice(0, 2)) {
      const name = chatNames[m.chat_id] || m.chat_name || m.chat_id
      const isA = m.reason === "escalate_a" || m.reason === "escalate"
      steps.push({
        key: m.chat_id,
        text: isA
          ? t("console.overview.stepEscalateA", { name })
          : t("console.overview.stepProbeB", { name }),
        action: () => navigateInboxChat(m.chat_id),
      })
    }
    return steps.slice(0, 3)
  }, [
    chatNames,
    health.agent,
    health.chatsReady,
    health.driver,
    health.wechatLoggedIn,
    mutes,
    navigateInboxChat,
    navigateSystem,
    t,
  ])

  async function handleMarkAllDone() {
    try {
      const count = await markAllDone()
      addToast(
        t("console.inbox.markAllDoneSuccess", { count }),
        count > 0 ? "success" : "info",
      )
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const features = [
    {
      key: "routing",
      title: t("console.overview.featureRouting"),
      desc: t("console.overview.featureRoutingDesc"),
      action: () => navigateBrain("routing"),
    },
    {
      key: "maintainer",
      title: t("console.overview.featureMaintainer"),
      desc: t("console.overview.featureMaintainerDesc"),
      action: () =>
        navigateInbox("chats", mutes.length > 0 ? "todo" : undefined),
    },
    {
      key: "kb",
      title: t("console.overview.featureKb"),
      desc: t("console.overview.featureKbDesc"),
      action: () => navigateBrain("kb"),
    },
    {
      key: "profile",
      title: t("console.overview.featureProfile"),
      desc: t("console.overview.featureProfileDesc"),
      action: () => navigateInbox("chats"),
    },
  ] as const

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <header className="mb-5 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                {headline}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("console.overview.subtitle")}
              </p>
            </div>
            {mutes.length > 0 && (
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => navigateInbox("chats", "todo")}
              >
                <Inbox className="mr-1.5 h-4 w-4" />
                {t("console.topbar.handleTodo", { count: mutes.length })}
              </Button>
            )}
          </div>
        </header>

        {!canServe && (
          <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {t("console.overview.repairTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("console.overview.repairHint")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => navigateSystem("services", "driver")}
              >
                {t("console.overview.repairServices")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigateSystemWechat()}
              >
                {t("console.overview.repairWechat")}
              </Button>
            </div>
          </div>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          <StatusBadge label="Driver" health={health.driver} />
          <StatusBadge
            label={t("console.overview.agentLabel")}
            health={health.agent}
          />
          <StatusBadge
            label="WeChat"
            health={
              health.driver !== "up"
                ? health.driver
                : !health.wechatLoggedIn
                  ? "degraded"
                  : health.chatsReady
                    ? "up"
                    : "degraded"
            }
          />
        </div>

        {nextSteps.length > 0 && (
          <section className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("console.overview.nextSteps")}
            </h2>
            <ol className="space-y-2">
              {nextSteps.map((step, i) => (
                <li
                  key={step.key}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{step.text}</span>
                  <Button size="sm" variant="outline" onClick={step.action}>
                    {t("console.overview.go")}
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("console.overview.timelineTitle")}
          </h2>
          <OverviewTimeline
            mutes={mutes}
            chatNames={chatNames}
            consoleEvents={consoleEvents}
          />
        </section>

        <OverviewKbGaps events={consoleEvents} chatNames={chatNames} />

        {mutes.length > 0 && (
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("console.overview.todoTitle", { count: mutes.length })}
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() => void handleMarkAllDone()}
              >
                {t("console.inbox.markAllDone")}
              </Button>
            </div>
            <ul className="space-y-2 text-sm">
              {mutes.map((m) => (
                <li key={m.chat_id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => navigateInboxChat(m.chat_id)}
                  >
                    <span className="font-medium">
                      {chatNames[m.chat_id] || m.chat_name || m.chat_id}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.reason}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("console.overview.features")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {features.map((f) => (
              <button
                key={f.key}
                type="button"
                className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40"
                onClick={f.action}
              >
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <details
          className="rounded-lg border bg-muted/20"
          open={traceOpen}
          onToggle={(e) => setTraceOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
            <span>{t("console.overview.traceTitle")}</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t("console.overview.traceFoldHint")}
            </span>
          </summary>
          <div className="border-t px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t("console.overview.traceHint")}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-xs"
                onClick={() => void refresh()}
              >
                {t("console.overview.traceRefresh")}
              </Button>
            </div>
            <OverviewAgentTrace
              events={consoleEvents}
              chatNames={chatNames}
              loading={eventsLoading}
            />
          </div>
        </details>
      </div>
    </div>
  )
}
