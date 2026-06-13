import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { StackPipeline } from "@/components/console/stack-pipeline"
import { useStackHealth } from "@/hooks/use-stack-health"
import { detectLegacyConfig } from "@/lib/agent-config-client"

const DISMISS_KEY = "cococat.gettingStarted.dismissed"

/** Onboarding hint — only on Stack「服务」tab (PLAN-console-ux Phase 1). */
export function StackGettingStarted() {
  const { t } = useTranslation()
  const health = useStackHealth()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1"
    } catch {
      return false
    }
  })
  const [needsMigrate, setNeedsMigrate] = useState(false)

  useEffect(() => {
    void detectLegacyConfig().then(setNeedsMigrate).catch(() => setNeedsMigrate(false))
  }, [])

  const ready =
    health.driver === "up" &&
    health.wechatLoggedIn &&
    health.chatsReady &&
    health.agent === "up"

  if (dismissed && !needsMigrate) return null
  if (ready && !needsMigrate) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{t("console.gettingStarted.title")}</p>
          {needsMigrate && (
            <p className="text-xs text-muted-foreground">
              {t("console.gettingStarted.migrateHint")}
            </p>
          )}
          <StackPipeline
            driver={health.driver}
            wechatLoggedIn={health.wechatLoggedIn}
            chatsReady={health.chatsReady}
            agent={health.agent}
          />
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={dismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
