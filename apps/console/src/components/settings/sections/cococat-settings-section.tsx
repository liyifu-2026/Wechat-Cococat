import { useCallback, useEffect, useState } from "react"
import { Copy, ExternalLink, FolderOpen, KeyRound, Settings2 } from "lucide-react"
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
import { useConsoleStore } from "@/stores/console-store"

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••"
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function CococatSettingsSection() {
  const { t } = useTranslation()
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const openSettingsModal = useConsoleStore((s) => s.openSettingsModal)
  const navigateSystemModels = useConsoleStore((s) => s.navigateSystemModels)
  const [paths, setPaths] = useState<CococatPaths | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [needsMigrate, setNeedsMigrate] = useState(false)
  const [copied, setCopied] = useState<"token" | null>(null)

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
      setCopied("token")
      window.setTimeout(() => setCopied(null), 2000)
    }
  }, [token])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.cococat.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.cococat.description")}
        </p>
      </div>

      {needsMigrate && (
        <div className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          {t("settings.sections.cococat.migrateHint")}
        </div>
      )}

      <div className="space-y-4 rounded-xl border p-4">
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
                {copied === "token"
                  ? t("settings.sections.cococat.copied")
                  : t("settings.sections.cococat.copyToken")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.cococat.tokenHint")}
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border p-4">
        <h3 className="text-sm font-medium">{t("settings.sections.cococat.envFiles")}</h3>
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          <li>
            <code className="text-xs">agent.env</code> —{" "}
            {t("settings.sections.cococat.agentEnv")}{" "}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => navigateSystemModels()}
            >
              {t("settings.sections.cococat.openAgentLlm")}
            </button>
          </li>
          <li>
            <code className="text-xs">memory.env</code> — {t("settings.sections.cococat.memoryEnv")}
          </li>
          <li>
            <code className="text-xs">persona.md</code> — {t("settings.sections.cococat.personaFile")}
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.cococat.envHint")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateSystemModels()}
        >
          <Settings2 className="mr-2 h-4 w-4" />
          {t("settings.sections.cococat.openAgentLlm")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigateBrain()}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {t("settings.sections.cococat.openAgent")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateBrain("routing")}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          {t("settings.sections.cococat.openAgentRuntime")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            openSettingsModal({ group: "system-advanced", tab: "about" })
          }
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          {t("settings.sections.cococat.openStack")}
        </Button>
      </div>
    </div>
  )
}
