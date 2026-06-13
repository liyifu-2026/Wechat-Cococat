import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import { applyAgentEnvVars } from "@/lib/agent-env"
import {
  AGENT_PRESET_ID_ENV,
  AGENT_UNSUPPORTED_PRESET_IDS,
  mapPresetToAgentEnv,
  readAgentPresetIdFromEnv,
} from "@/lib/agent-llm-mapper"
import { stackCommand } from "@/lib/stack-client"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { LLM_PRESETS } from "../llm-presets"
import { LlmPresetRow } from "./llm-provider-section"

type LoadState = "loading" | "ready" | "error"

export function AgentLlmSection() {
  const { t } = useTranslation()
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const setProviderConfigs = useWikiStore((s) => s.setProviderConfigs)
  const wikiActivePresetId = useWikiStore((s) => s.activePresetId)
  const llmConfig = useWikiStore((s) => s.llmConfig)

  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [agentPresetId, setAgentPresetId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const loadFromDisk = useCallback(async () => {
    setLoadState("loading")
    setLoadError(null)
    try {
      const raw = await readConfigFile("agent.env").catch(() => "")
      setAgentPresetId(readAgentPresetIdFromEnv(raw))
      setLoadState("ready")
    } catch (err) {
      setLoadState("error")
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadFromDisk()
  }, [loadFromDisk])

  async function persistProviderConfigs(next: typeof providerConfigs) {
    const { saveProviderConfigs } = await import("@/lib/project-store")
    setProviderConfigs(next)
    await saveProviderConfigs(next)
  }

  async function writeAgentEnvForPreset(presetId: string | null) {
    const raw = await readConfigFile("agent.env").catch(() => "")
    if (!presetId) {
      await writeConfigFile(
        "agent.env",
        applyAgentEnvVars(raw, { [AGENT_PRESET_ID_ENV]: "" }),
      )
      return
    }
    const preset = LLM_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const mapped = mapPresetToAgentEnv(preset, providerConfigs[presetId], llmConfig)
    if (!mapped.ok) {
      setStatusMsg(t(mapped.reasonKey))
      return
    }
    await writeConfigFile("agent.env", applyAgentEnvVars(raw, mapped.mapping.envVars))
  }

  async function updateOverride(id: string, patch: ProviderOverride) {
    const merged: ProviderOverride = { ...(providerConfigs[id] ?? {}), ...patch }
    const next = { ...providerConfigs, [id]: merged }
    await persistProviderConfigs(next)
    if (id === agentPresetId) {
      await writeAgentEnvForPreset(id)
    }
    setSavedId(id)
    window.setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1500)
  }

  async function toggleAgentPreset(id: string) {
    if (AGENT_UNSUPPORTED_PRESET_IDS.has(id)) {
      setStatusMsg(t("settings.sections.agentLlm.unsupportedPreset"))
      return
    }
    const next = id === agentPresetId ? null : id
    if (next) {
      const preset = LLM_PRESETS.find((p) => p.id === next)
      if (!preset) return
      const mapped = mapPresetToAgentEnv(preset, providerConfigs[next], llmConfig)
      if (!mapped.ok) {
        setStatusMsg(t(mapped.reasonKey))
        return
      }
    }
    setAgentPresetId(next)
    setStatusMsg(null)
    try {
      await writeAgentEnvForPreset(next)
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function syncFromWiki() {
    if (!wikiActivePresetId) {
      setStatusMsg(t("settings.sections.agentLlm.noWikiActive"))
      return
    }
    if (AGENT_UNSUPPORTED_PRESET_IDS.has(wikiActivePresetId)) {
      setStatusMsg(t("settings.sections.agentLlm.unsupportedPreset"))
      return
    }
    setAgentPresetId(wikiActivePresetId)
    setStatusMsg(null)
    try {
      await writeAgentEnvForPreset(wikiActivePresetId)
      setStatusMsg(t("settings.sections.agentLlm.syncedFromWiki"))
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRestartAgent() {
    setRestarting(true)
    setStatusMsg(null)
    try {
      await stackCommand("agent", "stop").catch(() => "")
      const out = await stackCommand("agent", "start")
      setStatusMsg(out.trim() || t("settings.sections.agentLlm.restartOk"))
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setRestarting(false)
    }
  }

  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.sections.agentLlm.loading")}
      </div>
    )
  }

  if (loadState === "error") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void loadFromDisk()}>
          {t("settings.sections.agentLlm.retry")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.agentLlm.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.agentLlm.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void syncFromWiki()}>
          {t("settings.sections.agentLlm.syncFromWiki")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRestartAgent()}
          disabled={restarting}
        >
          {restarting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t("settings.sections.agentLlm.restartAgent")}
        </Button>
      </div>

      <div className="space-y-2">
        {LLM_PRESETS.map((preset) => (
          <LlmPresetRow
            key={preset.id}
            preset={preset}
            override={providerConfigs[preset.id]}
            isActive={agentPresetId === preset.id}
            isExpanded={!!expanded[preset.id]}
            savedHere={savedId === preset.id}
            toggleDisabled={AGENT_UNSUPPORTED_PRESET_IDS.has(preset.id)}
            activeBadgeKey="settings.sections.agentLlm.activeBadge"
            onToggleActive={() => void toggleAgentPreset(preset.id)}
            onToggleExpand={() =>
              setExpanded((prev) => ({ ...prev, [preset.id]: !prev[preset.id] }))
            }
            onChange={(patch) => void updateOverride(preset.id, patch)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings.sections.agentLlm.footerHint")}
      </p>

      {statusMsg && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
          {statusMsg}
        </p>
      )}
    </div>
  )
}
