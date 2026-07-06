import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  Terminal,
  XCircle,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { CONSOLE_PANEL } from "@/lib/console-ui"
import {
  fetchRuntimeReadiness,
  type RuntimeReadiness,
  type RuntimeReadinessItem,
} from "@/lib/runtime-readiness"
import { copyText } from "@/lib/stack-status"
import { cn } from "@/lib/utils"

const INSTALL_COMMAND =
  "powershell -ExecutionPolicy Bypass -File .\\scripts\\install-windows.ps1 -BuildImage"

function stateIcon(state: RuntimeReadinessItem["state"]) {
  if (state === "ready") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (state === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600" />
  return <XCircle className="h-4 w-4 text-destructive" />
}

function readinessTone(readiness: RuntimeReadiness): string {
  return readiness.overall === "ready"
    ? "border-emerald-500/20 bg-emerald-500/5"
    : "border-amber-500/30 bg-amber-500/5"
}

export function RuntimeReadinessPanel() {
  const { t } = useTranslation()
  const [readiness, setReadiness] = useState<RuntimeReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setReadiness(await fetchRuntimeReadiness())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const missing = useMemo(
    () => readiness?.items.filter((item) => item.state !== "ready") ?? [],
    [readiness],
  )

  async function copyInstallCommand() {
    const ok = await copyText(INSTALL_COMMAND)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!readiness && !loading) return null

  return (
    <div
      className={cn(
        CONSOLE_PANEL,
        "space-y-4",
        readiness ? readinessTone(readiness) : "bg-muted/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              {t("console.runtime.title")}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {readiness?.overall === "ready"
              ? t("console.runtime.ready")
              : t("console.runtime.needsSetup")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {readiness?.overall !== "ready" && (
            <Button variant="outline" size="sm" onClick={() => void copyInstallCommand()}>
              <Copy className="mr-2 h-4 w-4" />
              {copied ? t("console.runtime.copied") : t("console.runtime.copyInstall")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            {t("console.refresh")}
          </Button>
        </div>
      </div>

      {readiness && (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {readiness.items.map((item) => (
              <div
                key={item.id}
                className="flex min-w-0 items-start gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2"
              >
                <div className="mt-0.5 shrink-0">{stateIcon(item.state)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-medium">{item.label}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t(`console.runtime.state.${item.state}`)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                  {item.action && item.state !== "ready" && (
                    <p className="mt-1 break-words text-xs text-foreground/80">
                      {item.action}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {missing.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-background/70 px-3 py-2">
              <code className="block break-words text-xs">{INSTALL_COMMAND}</code>
            </div>
          )}
        </>
      )}
    </div>
  )
}
