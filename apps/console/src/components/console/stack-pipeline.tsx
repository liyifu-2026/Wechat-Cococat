import { ArrowRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useConsoleStore } from "@/stores/console-store"
import type { ServiceHealth } from "@/lib/stack-status"

interface StackPipelineProps {
  driver: ServiceHealth
  wechatLoggedIn: boolean
  chatsReady: boolean
  agent: ServiceHealth
}

export function StackPipeline({
  driver,
  wechatLoggedIn,
  chatsReady,
  agent,
}: StackPipelineProps) {
  const { t } = useTranslation()
  const navigateStack = useConsoleStore((s) => s.navigateStack)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)

  const steps = [
    {
      done: driver === "up",
      label: t("console.gettingStarted.startDriver"),
      action: () => navigateStack("service", "driver"),
    },
    {
      done: wechatLoggedIn,
      label: t("console.gettingStarted.loginWechat"),
      action: () => navigateSystemWechat(),
    },
    {
      done: chatsReady,
      label: t("console.gettingStarted.syncWechatDb"),
      action: () => navigateSystemWechat(true),
    },
    {
      done: agent === "up",
      label: t("console.gettingStarted.startAgent"),
      action: () => navigateStack("service", "agent"),
    },
  ]

  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          {i > 0 && <ArrowRight className="h-3 w-3 shrink-0 opacity-50" />}
          <button
            type="button"
            onClick={step.action}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          >
            <span
              className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                step.done
                  ? "border-foreground/30 text-foreground"
                  : "border-border"
              }`}
            >
              {step.done ? "✓" : String(i + 1)}
            </span>
            {step.label}
          </button>
        </li>
      ))}
    </ol>
  )
}
