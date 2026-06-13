import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { ConsoleEventDto } from "@/lib/console-events-client"
import {
  buildAgentTraceTurns,
  compactTraceSteps,
  turnPreviewLine,
  type AgentTraceStep,
  type AgentTraceTurn,
} from "@/lib/agent-trace-view"
import { cn } from "@/lib/utils"

type OverviewAgentTraceProps = {
  events: ConsoleEventDto[]
  chatNames: Record<string, string>
  loading?: boolean
  maxTurns?: number
}

function formatTraceTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function phaseTone(phase: string): string {
  switch (phase) {
    case "reply":
    case "ack":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
    case "skip":
    case "discard":
      return "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
    case "thinking":
    case "gather":
    case "reflect":
    case "compose":
      return "border-violet-500/25 bg-violet-500/10 text-violet-900 dark:text-violet-100"
    case "tool":
      return "border-sky-500/25 bg-sky-500/10 text-sky-900 dark:text-sky-100"
    default:
      return "border-border bg-muted/50 text-muted-foreground"
  }
}

function StepRow({
  step,
  phaseLabel,
}: {
  step: AgentTraceStep
  phaseLabel: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const preview =
    step.detail?.replace(/\s+/g, " ").trim().slice(0, 96) ?? ""
  const hasMore = (step.detail?.length ?? 0) > 96

  return (
    <li className="rounded-md border bg-background/60 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            phaseTone(step.phase),
          )}
        >
          {phaseLabel}
        </span>
        <div className="min-w-0 flex-1">
          {step.query && (
            <p className="text-[11px] text-muted-foreground">{step.query}</p>
          )}
          {step.detail && (
            <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">
              {open ? step.detail : preview}
              {hasMore && !open && "…"}
            </p>
          )}
          {hasMore && (
            <button
              type="button"
              className="mt-1 text-[11px] text-primary hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open
                ? t("console.overview.traceCollapse")
                : t("console.overview.traceMore")}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function TurnCard({
  turn,
  name,
  expanded,
  verbose,
  onToggle,
}: {
  turn: AgentTraceTurn
  name: string
  expanded: boolean
  verbose: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const steps = useMemo(
    () => compactTraceSteps(turn.steps, verbose),
    [turn.steps, verbose],
  )
  const preview = turnPreviewLine(turn, verbose)

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/30"
        onClick={onToggle}
      >
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatTraceTime(turn.startedAt)}
            </span>
            <span className="text-sm font-medium">{name}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("console.overview.traceStepCount", { count: steps.length })}
            </span>
          </div>
          {!expanded && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {preview}
            </p>
          )}
        </div>
      </button>
      {expanded && (
        <ol className="max-h-[min(420px,50vh)] space-y-1.5 overflow-y-auto border-t px-2 py-2">
          {steps.map((step, idx) => (
            <StepRow
              key={`${step.ts}-${step.phase}-${idx}`}
              step={step}
              phaseLabel={t(`console.overview.tracePhase.${step.phase}`, {
                defaultValue: step.phase,
              })}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

export function OverviewAgentTrace({
  events,
  chatNames,
  loading = false,
  maxTurns = 4,
}: OverviewAgentTraceProps) {
  const { t } = useTranslation()
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null)
  const [verbose, setVerbose] = useState(false)

  const turns = useMemo(
    () => buildAgentTraceTurns(events, maxTurns),
    [events, maxTurns],
  )

  if (loading && turns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("console.overview.traceLoading")}
      </p>
    )
  }

  if (turns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("console.overview.traceEmpty")}
      </p>
    )
  }

  const activeExpanded =
    expandedTurnId && turns.some((t) => t.turnId === expandedTurnId)
      ? expandedTurnId
      : turns[0]?.turnId ?? null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={verbose ? "secondary" : "ghost"}
          className="h-7 text-xs"
          onClick={() => setVerbose((v) => !v)}
        >
          {verbose
            ? t("console.overview.traceCompact")
            : t("console.overview.traceVerbose")}
        </Button>
      </div>
      {turns.map((turn) => {
        const name =
          (turn.chatId && chatNames[turn.chatId]) ||
          turn.chatName ||
          turn.chatId ||
          "—"
        return (
          <TurnCard
            key={turn.turnId}
            turn={turn}
            name={name}
            expanded={activeExpanded === turn.turnId}
            verbose={verbose}
            onToggle={() =>
              setExpandedTurnId((cur) =>
                cur === turn.turnId ? null : turn.turnId,
              )
            }
          />
        )
      })}
    </div>
  )
}
