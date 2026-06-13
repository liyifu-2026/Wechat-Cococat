import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { ConsoleEventDto } from "@/lib/console-events-client"
import { extractKbGapEvents } from "@/lib/overview-timeline"
import { useConsoleStore } from "@/stores/console-store"

type OverviewKbGapsProps = {
  events: ConsoleEventDto[]
  chatNames: Record<string, string>
}

export function OverviewKbGaps({ events, chatNames }: OverviewKbGapsProps) {
  const { t } = useTranslation()
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)

  const gaps = useMemo(
    () => extractKbGapEvents(events, chatNames, 6),
    [events, chatNames],
  )

  if (gaps.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("console.overview.kbGapsTitle")}
      </h2>
      <ul className="space-y-2">
        {gaps.map((gap) => (
          <li
            key={gap.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm"
          >
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
              {gap.timeLabel}
            </span>
            <span className="min-w-0 flex-1">
              {t("console.overview.timelineKbGap", {
                topic: gap.topic ?? gap.name,
              })}
            </span>
            {gap.chatId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigateInboxChat(gap.chatId!)}
              >
                {t("console.overview.timelineView")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigateBrain("kb", {
                  topic: gap.topic ?? gap.name,
                  openInEditMode: true,
                })
              }
            >
              {t("console.overview.timelineEditKb")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
