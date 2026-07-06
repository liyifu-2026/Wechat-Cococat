import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ModuleTabs } from "@/components/console/module-tabs"
import { StackGettingStarted } from "@/components/console/stack-getting-started"
import { SystemWechatConnect } from "@/components/console/system-wechat-connect"
import { RuntimeReadinessPanel } from "@/components/console/runtime-readiness-panel"
import { StatusBadge } from "@/components/console/status-badge"
import { useModuleTab } from "@/hooks/use-module-tab"
import {
  refreshStackHealth,
  useStackHealth,
} from "@/hooks/use-stack-health"
import { readStackLog } from "@/lib/agent-config-client"
import {
  LAYOUT_KEYS,
  STACK_TABS,
  type StackTab,
} from "@/lib/console-layout"
import {
  runStackOrchestrator,
  type StackOrchestratorPhase,
  type StackOrchestratorProgress,
} from "@/lib/stack-orchestrator"
import type { StackHealthService } from "@/lib/stack-client"
import { STACK_CLI_HINTS, copyText, type ServiceHealth } from "@/lib/stack-status"
import { CONSOLE_PANEL } from "@/lib/console-ui"
import { useConsoleStore } from "@/stores/console-store"
import { cn } from "@/lib/utils"

type ServiceState = {
  label: string
  service: StackOrchestratorPhase
  status: string
  health: ServiceHealth
}

const SERVICES: Omit<ServiceState, "status" | "health">[] = [
  { label: "Driver", service: "driver" },
  { label: "Memory", service: "memory" },
  { label: "Agent", service: "agent" },
]

const PHASE_LABEL_KEYS: Record<
  StackOrchestratorPhase,
  "console.stack.phaseDriver" | "console.stack.phaseMemory" | "console.stack.phaseAgent"
> = {
  driver: "console.stack.phaseDriver",
  memory: "console.stack.phaseMemory",
  agent: "console.stack.phaseAgent",
}

function isMemorySetupError(status: string): boolean {
  return /gateway|TencentDB|clone/i.test(status)
}

function StackProgressBar({
  percent,
  label,
}: {
  percent: number
  label: string
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {Math.round(percent)}%
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  )
}

type StackModuleProps = {
  /** 嵌入系统侧栏时隐藏模块级标题与 Tab */
  embedded?: boolean
  forcedTab?: StackTab
}

export function StackModule({ embedded = false, forcedTab }: StackModuleProps = {}) {
  const { t } = useTranslation()
  const health = useStackHealth()
  const pendingStackTab = useConsoleStore((s) => s.pendingStackTab)
  const highlightStackService = useConsoleStore((s) => s.highlightStackService)
  const clearStackNavigation = useConsoleStore((s) => s.clearStackNavigation)

  const [activeTab, setActiveTab] = useModuleTab<StackTab>({
    storageKey: LAYOUT_KEYS.stackTab,
    allowed: STACK_TABS,
    defaultTab: "service",
    forcedTab: forcedTab ?? null,
  })

  const rows = useMemo(
    (): ServiceState[] =>
      SERVICES.map((svc) => ({
        ...svc,
        health: health[svc.service],
        status: health.loading ? "…" : health.statusLines[svc.service] || "—",
      })),
    [health],
  )

  const [orchestrator, setOrchestrator] = useState<StackOrchestratorProgress | null>(
    null,
  )
  const [log, setLog] = useState<string | null>(null)
  const [logFailed, setLogFailed] = useState(false)
  const [lastAction, setLastAction] = useState<"start" | "stop" | null>(null)
  const [agentLog, setAgentLog] = useState("")
  const [copied, setCopied] = useState(false)
  const [focusedService, setFocusedService] = useState<StackHealthService | null>(
    null,
  )
  const cardRefs = useRef<Partial<Record<StackHealthService, HTMLDivElement | null>>>(
    {},
  )

  const busy = orchestrator !== null && orchestrator.percent < 100

  useEffect(() => {
    if (!pendingStackTab && !highlightStackService) return
    if (pendingStackTab) setActiveTab(pendingStackTab)
    if (highlightStackService && highlightStackService !== "all") {
      setFocusedService(highlightStackService)
      const el = cardRefs.current[highlightStackService]
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      const id = window.setTimeout(() => setFocusedService(null), 3000)
      clearStackNavigation()
      return () => window.clearTimeout(id)
    }
    clearStackNavigation()
  }, [pendingStackTab, highlightStackService, setActiveTab, clearStackNavigation])

  const refreshAgentLog = useCallback(async () => {
    try {
      setAgentLog(await readStackLog(60))
    } catch {
      setAgentLog("")
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await refreshStackHealth()
    await refreshAgentLog()
  }, [refreshAgentLog])

  useEffect(() => {
    void refreshAgentLog()
  }, [refreshAgentLog])

  async function runOrchestrator(action: "start" | "stop") {
    setLog(null)
    setLogFailed(false)
    setLastAction(action)
    setOrchestrator({
      action,
      phase: action === "start" ? "driver" : "agent",
      step: 1,
      totalSteps: 3,
      percent: 0,
      logs: [],
    })

    const result = await runStackOrchestrator(action, (progress) => {
      setOrchestrator(progress)
    })

    setOrchestrator((prev) =>
      prev
        ? { ...prev, phase: null, step: 3, percent: 100, logs: result.logs }
        : null,
    )
    setLog(result.logs.join("\n\n") || null)
    setLogFailed(!result.ok)
    await refreshAll()
    window.setTimeout(() => setOrchestrator(null), result.ok ? 800 : 0)
  }

  async function copyCliHint() {
    if (!lastAction) return
    const hint = STACK_CLI_HINTS.all[lastAction]
    const ok = await copyText(hint)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const progressLabel = useMemo(() => {
    if (!orchestrator || orchestrator.percent >= 100) {
      return lastAction === "stop"
        ? t("console.stack.progressDoneStop")
        : t("console.stack.progressDoneStart")
    }
    if (!orchestrator.phase) {
      return t("console.stack.progressFinishing")
    }
    const phaseLabel = t(PHASE_LABEL_KEYS[orchestrator.phase])
    return orchestrator.action === "start"
      ? t("console.stack.progressStarting", { phase: phaseLabel })
      : t("console.stack.progressStopping", { phase: phaseLabel })
  }, [orchestrator, lastAction, t])

  const cliHint = lastAction ? STACK_CLI_HINTS.all[lastAction] : null

  const tabs = [
    { id: "service" as const, label: t("console.stack.tabs.service") },
    { id: "logs" as const, label: t("console.stack.tabs.logs") },
  ]

  const toolbar = activeTab === "service" ? (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => void runOrchestrator("start")}>
        {t("console.stack.startStack")}
      </Button>
      <Button
        variant="destructive"
        disabled={busy}
        onClick={() => void runOrchestrator("stop")}
      >
        {t("console.stack.stopStack")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void refreshAll()}
        disabled={busy || health.loading}
      >
        <RefreshCw
          className={`mr-2 h-4 w-4 ${busy || health.loading ? "animate-spin" : ""}`}
        />
        {t("console.refresh")}
      </Button>
    </div>
  ) : (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void refreshAll()}
      disabled={busy}
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {t("console.refresh")}
    </Button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-0 pt-6">
          <div>
            <h1 className="text-xl font-semibold">{t("console.stack.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("console.stack.subtitle")}
            </p>
          </div>
          {toolbar}
        </div>
      )}

      {embedded && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-8 py-3">
          {toolbar}
        </div>
      )}

      {!embedded && (
        <ModuleTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      )}

      {activeTab === "service" && (
        <div className={cn("min-h-0 flex-1 overflow-auto py-4", embedded ? "px-8" : "px-6")}>
          <div className="flex flex-col gap-4">
            <RuntimeReadinessPanel />
            <StackGettingStarted />

            {orchestrator && (
              <StackProgressBar
                percent={orchestrator.percent}
                label={progressLabel}
              />
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {rows.map((row) => {
                const phaseActive =
                  busy && orchestrator?.phase === row.service
                return (
                  <div
                    key={row.service}
                    ref={(el) => {
                      cardRefs.current[row.service] = el
                    }}
                    className={cn(
                      CONSOLE_PANEL,
                      focusedService === row.service && "ring-2 ring-foreground/25",
                      phaseActive && "ring-2 ring-primary/40",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 className="font-medium">
                        {row.label}
                        {row.service === "memory" && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {t("console.stack.memoryOptional")}
                          </span>
                        )}
                      </h2>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {row.service === "driver" && health.driver === "up" && (
                          <StatusBadge
                            label="WeChat"
                            health={
                              !health.wechatLoggedIn
                                ? "degraded"
                                : health.chatsReady
                                  ? "up"
                                  : "degraded"
                            }
                          />
                        )}
                        <StatusBadge health={row.health} />
                      </div>
                    </div>
                    {row.health === "down" && isMemorySetupError(row.status) && (
                      <p className="mb-2 text-xs text-destructive">{row.status}</p>
                    )}
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none">
                        {t("console.stack.details")}
                      </summary>
                      <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap">
                        {row.status}
                      </pre>
                    </details>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("console.stack.orderHint")}
            </p>

            {log && (
              <div
                className={cn(
                  "rounded-md border p-4 text-xs whitespace-pre-wrap",
                  logFailed
                    ? "border-destructive/40 text-destructive"
                    : "bg-muted/30",
                )}
              >
                <pre className="whitespace-pre-wrap">{log}</pre>
                {logFailed && cliHint && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-destructive/20 pt-3 text-foreground">
                    <code className="rounded bg-background/80 px-2 py-1 text-[11px]">
                      {cliHint}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => void copyCliHint()}>
                      <Copy className="mr-1 h-3 w-3" />
                      {copied ? t("console.stack.copied") : t("console.stack.copyCli")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {embedded && <SystemWechatConnect />}
          </div>
        </div>
      )}

      {activeTab === "logs" && (
        <div className={cn("min-h-0 flex-1 overflow-auto py-4", embedded ? "px-8" : "px-6")}>
          <div className="flex flex-col gap-4">
            {log && (
              <div className={CONSOLE_PANEL}>
                <h2 className="mb-2 font-medium">{t("console.stack.commandOutput")}</h2>
                <pre
                  className={cn(
                    "max-h-48 overflow-auto text-xs whitespace-pre-wrap",
                    logFailed ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {log}
                </pre>
              </div>
            )}
            <div className={CONSOLE_PANEL}>
              <h2 className="mb-2 font-medium">{t("console.stack.agentLog")}</h2>
              <pre className="max-h-[min(24rem,50vh)] overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                {agentLog || t("console.stack.noLog")}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
