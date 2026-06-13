import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import type { ConsoleEventDto } from "@/lib/console-events-client"
import { buildOverviewTimeline } from "@/lib/overview-timeline"
import { useConsoleStore } from "@/stores/console-store"

type OverviewTimelineProps = {
  mutes: EscalationMuteEntry[]
  chatNames: Record<string, string>
  consoleEvents?: ConsoleEventDto[]
}

export function OverviewTimeline({
  mutes,
  chatNames,
  consoleEvents = [],
}: OverviewTimelineProps) {
  const { t } = useTranslation()
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)

  const events = useMemo(
    () => buildOverviewTimeline(mutes, chatNames, consoleEvents),
    [mutes, chatNames, consoleEvents],
  )

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("console.overview.timelineEmpty")}
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {events.map((ev) => (
        <li
          key={ev.id}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
        >
          <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
            {ev.timeLabel}
          </span>
          <span className="min-w-0 flex-1">
            {ev.kind === "escalate" && (
              t("console.overview.timelineEscalate", { name: ev.name })
            )}
            {ev.kind === "probe" && (
              t("console.overview.timelineProbe", { name: ev.name })
            )}
            {ev.kind === "auto_reply" && (
              t("console.overview.timelineAutoReply", {
                name: ev.name,
                topic: ev.topic ?? "",
              })
            )}
            {ev.kind === "kb_gap" && (
              t("console.overview.timelineKbGap", { topic: ev.name })
            )}
          </span>
          {(ev.kind === "escalate" || ev.kind === "probe") && ev.chatId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateInboxChat(ev.chatId!)}
            >
              {t("console.overview.timelineView")}
            </Button>
          )}
          {ev.kind === "auto_reply" && ev.chatId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateInboxChat(ev.chatId!)}
            >
              {t("console.overview.timelineView")}
            </Button>
          )}
          {ev.kind === "kb_gap" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigateBrain("kb", {
                  topic: ev.topic ?? ev.name,
                  openInEditMode: true,
                })
              }
            >
              {t("console.overview.timelineEditKb")}
            </Button>
          )}
          {ev.kind === "auto_reply" && !ev.chatId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateInbox("chats")}
            >
              {t("console.overview.timelineView")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
