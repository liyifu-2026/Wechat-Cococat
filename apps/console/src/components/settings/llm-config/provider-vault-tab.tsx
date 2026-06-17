import { useEffect, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LlmStackFile } from "@cococat/shared/llm-stack"
import {
  isProviderConfigured,
  listVaultProviderIds,
} from "@cococat/shared/llm-stack"
import { Button } from "@/components/ui/button"
import { LLM_PRESETS } from "../llm-presets"
import { LlmPresetRow } from "../sections/llm-provider-section"
import type { ProviderConfigs, ProviderOverride } from "@/stores/wiki-store"
import { isProviderUsedInStack } from "./llm-config-utils"

type ProviderVaultTabProps = {
  stack: LlmStackFile
  providerConfigs: ProviderConfigs
  onChangeConfigs: (next: ProviderConfigs) => void
}

export function ProviderVaultTab({
  stack,
  providerConfigs,
  onChangeConfigs,
}: ProviderVaultTabProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  const vaultIds = useMemo(() => {
    const ids = listVaultProviderIds(providerConfigs).filter((id) =>
      LLM_PRESETS.some((p) => p.id === id),
    )
    return ids.sort((a, b) => {
      const la = LLM_PRESETS.find((p) => p.id === a)?.label ?? a
      const lb = LLM_PRESETS.find((p) => p.id === b)?.label ?? b
      return la.localeCompare(lb)
    })
  }, [providerConfigs])

  const addable = LLM_PRESETS.filter((p) => !vaultIds.includes(p.id))

  useEffect(() => {
    if (!showAdd) return
    function onPointerDown(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) {
        setShowAdd(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [showAdd])

  function updateOverride(id: string, patch: ProviderOverride) {
    const merged: ProviderOverride = { ...(providerConfigs[id] ?? {}), ...patch }
    onChangeConfigs({ ...providerConfigs, [id]: merged })
  }

  function addProvider(id: string) {
    onChangeConfigs({ ...providerConfigs, [id]: providerConfigs[id] ?? {} })
    setExpanded((prev) => ({ ...prev, [id]: true }))
    setShowAdd(false)
  }

  function removeProvider(id: string) {
    if (isProviderUsedInStack(stack, id)) {
      const ok = window.confirm(t("settings.sections.llmConfig.removeInUseConfirm"))
      if (!ok) return
    }
    const next = { ...providerConfigs }
    delete next[id]
    onChangeConfigs(next)
    setExpanded((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  return (
    <div className="space-y-4">
      {vaultIds.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t("settings.sections.llmConfig.noProviders")}
        </p>
      )}

      <div className="space-y-2">
        {vaultIds.map((id) => {
          const preset = LLM_PRESETS.find((p) => p.id === id)
          if (!preset) return null
          const configured = isProviderConfigured(id, providerConfigs)
          return (
            <LlmPresetRow
              key={id}
              preset={preset}
              override={providerConfigs[id]}
              isActive={configured}
              isExpanded={expanded[id] ?? !configured}
              savedHere={false}
              toggleDisabled
              hideActiveToggle
              credentialsOnly
              activeBadgeKey={
                configured
                  ? "settings.sections.llmConfig.configuredBadge"
                  : "settings.sections.llmConfig.pendingBadge"
              }
              onToggleActive={() => {}}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const open = prev[id] ?? !configured
                  return { ...prev, [id]: !open }
                })
              }
              onChange={(patch) => updateOverride(id, patch)}
              onRemove={() => removeProvider(id)}
            />
          )
        })}
      </div>

      <div className="relative" ref={addMenuRef}>
        <Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("settings.sections.llmConfig.addProvider")}
        </Button>
        {showAdd && addable.length > 0 && (
          <div className="absolute z-10 mt-2 max-h-64 w-full max-w-md overflow-auto rounded-md border bg-popover p-2 shadow-md">
            {addable.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="flex w-full flex-col rounded px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => addProvider(preset.id)}
              >
                <span className="font-medium">{preset.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
