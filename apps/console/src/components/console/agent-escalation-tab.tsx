import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  readConfigFile,
  writeConfigFile,
} from "@/lib/agent-config-client"
import {
  DEFAULT_ESCALATION,
  parseEscalationConfig,
  serializeEscalationConfig,
  type EscalationConfigFile,
} from "@/lib/escalation-config"
import { inferLlmStack, persistLlmStack } from "@/lib/llm-stack-persist"
import { useWikiStore } from "@/stores/wiki-store"
import { CONSOLE_PANEL } from "@/lib/console-ui"

const RULES = [
  {
    id: "reply",
    titleKey: "console.agent.escalation.ruleReplyTitle",
    descKey: "console.agent.escalation.ruleReplyDesc",
  },
  {
    id: "deflect",
    titleKey: "console.agent.escalation.ruleDeflectTitle",
    descKey: "console.agent.escalation.ruleDeflectDesc",
  },
  {
    id: "escalate",
    titleKey: "console.agent.escalation.ruleEscalateTitle",
    descKey: "console.agent.escalation.ruleEscalateDesc",
  },
  {
    id: "probe",
    titleKey: "console.agent.escalation.ruleProbeTitle",
    descKey: "console.agent.escalation.ruleProbeDesc",
  },
] as const

export function AgentEscalationTab() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<EscalationConfigFile>(DEFAULT_ESCALATION)
  const [unifiedGateLlm, setUnifiedGateLlm] = useState(true)
  const [gateSaving, setGateSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [raw, agentEnv] = await Promise.all([
        readConfigFile("escalation.json"),
        readConfigFile("agent.env").catch(() => ""),
      ])
      setConfig(parseEscalationConfig(raw))
      const store = useWikiStore.getState()
      const stack = await inferLlmStack(
        store.activePresetId,
        store.providerConfigs,
        agentEnv,
      )
      setUnifiedGateLlm(stack.unifiedGateLlm !== false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function saveUnifiedGate(enabled: boolean) {
    setGateSaving(true)
    setError(null)
    try {
      const store = useWikiStore.getState()
      const agentEnv = await readConfigFile("agent.env").catch(() => "")
      const stack = await inferLlmStack(
        store.activePresetId,
        store.providerConfigs,
        agentEnv,
      )
      await persistLlmStack({
        stack: { ...stack, unifiedGateLlm: enabled },
        providerConfigs: store.providerConfigs,
        llmConfig: store.llmConfig,
      })
      setUnifiedGateLlm(enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGateSaving(false)
    }
  }

  async function saveConfig() {
    setSaving(true)
    setMessage(null)
    try {
      const payload = serializeEscalationConfig({
        ...config,
        wikiLinks: (config.wikiLinks ?? []).filter(
          (l) => l.path.trim() && l.note.trim(),
        ),
      })
      const text = JSON.stringify(payload, null, 2) + "\n"
      await writeConfigFile("escalation.json", text)
      setConfig(payload)
      setMessage(t("console.agent.escalation.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-4 pb-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("console.agent.escalation.hint")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void loadAll()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("console.refresh")}
        </Button>
      </div>

      {message && (
        <div className="mb-4 rounded-md border px-4 py-2 text-sm">{message}</div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid max-w-3xl gap-4">
        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <div>
            <h2 className="font-medium">
              {t("console.agent.escalation.rulesTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("console.agent.escalation.silentNote")}
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {RULES.map(({ id, titleKey, descKey }) => (
              <li
                key={id}
                className="rounded-md border border-border/60 bg-muted/20 p-3"
              >
                <h3 className="text-sm font-medium">{t(titleKey)}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t(descKey)}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-2`}>
          <h2 className="font-medium">{t("console.agent.escalation.triageTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("console.agent.escalation.triageHint")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unifiedGateLlm}
              disabled={gateSaving}
              onChange={(e) => void saveUnifiedGate(e.target.checked)}
            />
            {t("settings.sections.llmConfig.unifiedGate")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.triage.useLlm}
              onChange={(e) =>
                setConfig((p) => ({
                  ...p,
                  triage: { useLlm: e.target.checked },
                }))
              }
            />
            {t("console.agent.escalation.useLlm")}
          </label>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-2`}>
          <h2 className="font-medium">{t("console.agent.escalation.notify")}</h2>
          {(
            [
              ["escalate", "notifyEscalate"],
              ["probeLoop", "notifyProbe"],
              ["lowConfidence", "notifyLowConfidence"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.notifyOn[key]}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    notifyOn: { ...p.notifyOn, [key]: e.target.checked },
                  }))
                }
              />
              {t(`console.agent.escalation.${labelKey}`)}
            </label>
          ))}
        </div>

        <Button className="w-fit" onClick={() => void saveConfig()} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {t("console.agent.save")}
        </Button>
      </div>
    </div>
  )
}
