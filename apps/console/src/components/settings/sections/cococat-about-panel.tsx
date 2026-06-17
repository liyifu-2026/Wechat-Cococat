import { useCallback, useEffect, useState } from "react"
import { Copy, FolderOpen, KeyRound } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  detectLegacyConfig,
  getCococatPaths,
  openCococatFolder,
  type CococatPaths,
} from "@/lib/agent-config-client"
import { readCococatToken } from "@/lib/stack-client"
import { copyText } from "@/lib/stack-status"

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••"
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

/** Program paths & token — embedded in About (no separate「程序」页). */
export function CococatAboutPanel() {
  const { t } = useTranslation()
  const [paths, setPaths] = useState<CococatPaths | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [needsMigrate, setNeedsMigrate] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void getCococatPaths().then(setPaths).catch(() => setPaths(null))
    void readCococatToken()
      .then(setToken)
      .catch(() => setToken(null))
    void detectLegacyConfig().then(setNeedsMigrate).catch(() => setNeedsMigrate(false))
  }, [])

  const copyToken = useCallback(async () => {
    if (!token) return
    const ok = await copyText(token)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }, [token])

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{t("settings.sections.cococat.title")}</h3>

      {needsMigrate && (
        <p className="text-xs text-amber-700 dark:text-amber-200">
          {t("settings.sections.cococat.migrateHint")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{t("settings.sections.cococat.configDir")}</Label>
          <code className="block break-all rounded-md bg-muted px-2 py-1.5 text-xs">
            {paths?.config_dir ?? "—"}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void openCococatFolder("config")}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("settings.sections.cococat.openConfig")}
          </Button>
        </div>

        <div className="space-y-1">
          <Label>{t("settings.sections.cococat.dataDir")}</Label>
          <code className="block break-all rounded-md bg-muted px-2 py-1.5 text-xs">
            {paths?.data_dir ?? "—"}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void openCococatFolder("data")}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("settings.sections.cococat.openData")}
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label>{t("settings.sections.cococat.driverToken")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <code className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            {token ? maskToken(token) : t("settings.sections.cococat.noToken")}
          </code>
          {token && (
            <Button variant="outline" size="sm" onClick={() => void copyToken()}>
              <Copy className="mr-1 h-3 w-3" />
              {copied
                ? t("settings.sections.cococat.copied")
                : t("settings.sections.cococat.copyToken")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
