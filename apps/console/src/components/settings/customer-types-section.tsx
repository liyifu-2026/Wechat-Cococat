import { useCallback, useEffect, useState } from "react"
import { ChevronDown, FolderOpen, Plus, Settings2, Trash2 } from "lucide-react"
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { openProject } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  loadWikiBindPickerOptions,
  type WikiBindPickerOption,
} from "@/lib/inbox-wiki-bind-options"
import { ensureProjectId } from "@/lib/project-identity"
import { upsertWikiRegistryEntry } from "@/lib/wiki-registry-sync"
import { normalizePath } from "@/lib/path-utils"
import { slugifyCustomerTypeId } from "@/lib/contact-category"
import {
  readCustomerTypesConfig,
  writeCustomerTypesConfig,
  type CustomerTypeEntry,
} from "@/lib/customer-types"
import { useConsoleStore } from "@/stores/console-store"
import { useToastStore } from "@/stores/toast-store"
import { cn } from "@/lib/utils"

function emptyEntry(sortOrder: number): CustomerTypeEntry {
  return {
    id: `type_${Date.now()}_${sortOrder}`,
    label: "",
    wikiProjects: [],
    behaviorGuide: "",
    sortOrder,
  }
}

function ensureTypeIds(types: CustomerTypeEntry[]): CustomerTypeEntry[] {
  const used = new Set<string>()
  return types.map((row, index) => {
    const label = row.label.trim()
    let id = row.id.trim()
    if (!id || used.has(id)) {
      id = slugifyCustomerTypeId(label || `type_${index}`, used)
    } else {
      used.add(id)
    }
    return {
      ...row,
      id,
      label,
      sortOrder: index,
    }
  })
}

function WikiPresetDialog({
  open,
  selected,
  wikiOptions,
  onClose,
  onSave,
  onReloadOptions,
}: {
  open: boolean
  selected: string[]
  wikiOptions: WikiBindPickerOption[]
  onClose: () => void
  onSave: (aliases: string[]) => void
  onReloadOptions: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    if (open) setDraft(new Set(selected))
  }, [open, selected])

  function toggle(alias: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })
  }

  async function handleBrowse() {
    setOpening(true)
    try {
      const picked = await openFolderDialog({
        directory: true,
        multiple: false,
        title: t("welcome.openProject"),
      })
      if (!picked) return
      const project = await openProject(picked)
      const projectPath = normalizePath(project.path)
      const projectId = project.id || (await ensureProjectId(projectPath))
      const alias = await upsertWikiRegistryEntry(projectPath, projectId)
      await onReloadOptions()
      setDraft((prev) => new Set(prev).add(alias))
    } finally {
      setOpening(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="wechat-settings-dialog max-w-md border-[var(--wx-border)] bg-[var(--wx-header-bg)] text-[var(--wx-text)]">
        <DialogHeader>
          <DialogTitle>{t("wechat.customerTypes.wikiPresetLabel")}</DialogTitle>
        </DialogHeader>
        {wikiOptions.length === 0 ? (
          <p className="text-sm text-[var(--wx-muted)]">
            {t("wechat.customerTypes.noWikiOptions")}
          </p>
        ) : (
          <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-[var(--wx-border)] p-1">
            {wikiOptions.map((opt) => (
              <li key={opt.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--wx-list-hover)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={draft.has(opt.alias)}
                    onChange={() => toggle(opt.alias)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{opt.name}</span>
                    <span className="block truncate text-[11px] text-[var(--wx-muted)]">
                      {opt.alias}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => onSave([...draft])}>
            {t("wechat.customerTypes.wikiPresetConfirm")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={opening}
            onClick={() => void handleBrowse()}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            {t("wechat.aiAssist.wikiBindBrowse")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("wechat.aiAssist.wikiBindCancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TypeRow({
  row,
  guideExpanded,
  onToggleGuide,
  onUpdate,
  onOpenWikiSettings,
  onRemove,
}: {
  row: CustomerTypeEntry
  guideExpanded: boolean
  onToggleGuide: () => void
  onUpdate: (patch: Partial<CustomerTypeEntry>) => void
  onOpenWikiSettings: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const presetLabel =
    row.wikiProjects.length > 0
      ? row.wikiProjects.join(" · ")
      : t("wechat.customerTypes.noWikiBound")

  return (
    <div className="rounded-lg border border-[var(--wx-border)] bg-[var(--wx-header-bg)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <Input
          value={row.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={t("wechat.customerTypes.labelPlaceholder")}
          className="h-8 min-w-0 flex-1 border-[var(--wx-border)] bg-[var(--wx-search-input)] text-sm text-[var(--wx-text)]"
        />
        <button
          type="button"
          onClick={onOpenWikiSettings}
          className="flex min-w-0 max-w-[40%] items-center gap-1 rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2 py-1 text-left text-xs text-[var(--wx-muted)] hover:border-[var(--wx-accent)] hover:text-[var(--wx-text)]"
          title={t("wechat.customerTypes.wikiPresetSettings")}
        >
          <span className="truncate">{presetLabel}</span>
          <Settings2 className="h-3.5 w-3.5 shrink-0" />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-[var(--wx-muted)] hover:text-destructive"
          aria-label={t("wechat.customerTypes.remove")}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-[var(--wx-muted)]"
          aria-label={t("wechat.customerTypes.behaviorGuideLabel")}
          aria-expanded={guideExpanded}
          onClick={onToggleGuide}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              guideExpanded && "rotate-180",
            )}
          />
        </Button>
      </div>
      {guideExpanded && (
        <div className="border-t border-[var(--wx-border)]/60 px-3 pb-3 pt-2">
          <textarea
            value={row.behaviorGuide ?? ""}
            onChange={(e) => onUpdate({ behaviorGuide: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2.5 py-2 text-xs text-[var(--wx-text)]"
            placeholder={t("wechat.customerTypes.behaviorGuidePlaceholder")}
          />
        </div>
      )}
    </div>
  )
}

export function CustomerTypesSection() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const closeSettingsModal = useConsoleStore((s) => s.closeSettingsModal)
  const [types, setTypes] = useState<CustomerTypeEntry[]>([])
  const [wikiOptions, setWikiOptions] = useState<WikiBindPickerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedGuides, setExpandedGuides] = useState<Set<number>>(new Set())
  const [wikiDialogIndex, setWikiDialogIndex] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [config, options] = await Promise.all([
        readCustomerTypesConfig(),
        loadWikiBindPickerOptions(),
      ])
      setTypes(config.types)
      setWikiOptions(options)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  function updateType(index: number, patch: Partial<CustomerTypeEntry>) {
    setTypes((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  function toggleGuide(index: number) {
    setExpandedGuides((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleSave() {
    const normalized = ensureTypeIds(
      types.filter((row) => row.label.trim().length > 0),
    )
    if (normalized.length === 0) {
      addToast(t("wechat.customerTypes.emptyError"), "error")
      return
    }
    setSaving(true)
    try {
      await writeCustomerTypesConfig({ types: normalized })
      addToast(t("wechat.customerTypes.saveSuccess"), "success")
      await reload()
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setSaving(false)
    }
  }

  function openKnowledgeBase() {
    closeSettingsModal()
    navigateBrain("kb")
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--wx-muted)]">
        {t("wechat.customerTypes.loading")}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--wx-text)]">
              {t("wechat.customerTypes.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--wx-muted)]">
              {t("wechat.customerTypes.description")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-[var(--wx-border)]"
            onClick={openKnowledgeBase}
          >
            {t("wechat.customerTypes.manageWikiProjects")}
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {types.length === 0 ? (
            <p className="text-sm text-[var(--wx-muted)]">
              {t("wechat.customerTypes.emptyHint")}
            </p>
          ) : (
            types.map((row, index) => (
              <TypeRow
                key={`${row.id}-${index}`}
                row={row}
                guideExpanded={expandedGuides.has(index)}
                onToggleGuide={() => toggleGuide(index)}
                onUpdate={(patch) => updateType(index, patch)}
                onOpenWikiSettings={() => setWikiDialogIndex(index)}
                onRemove={() =>
                  setTypes((prev) => prev.filter((_, i) => i !== index))
                }
              />
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-8 py-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-[var(--wx-border)]"
          onClick={() =>
            setTypes((prev) => [...prev, emptyEntry(prev.length)])
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("wechat.customerTypes.add")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || types.length === 0}
          onClick={() => void handleSave()}
        >
          {saving
            ? t("wechat.customerTypes.saving")
            : t("wechat.customerTypes.save")}
        </Button>
      </div>

      <WikiPresetDialog
        open={wikiDialogIndex != null}
        selected={
          wikiDialogIndex != null
            ? (types[wikiDialogIndex]?.wikiProjects ?? [])
            : []
        }
        wikiOptions={wikiOptions}
        onClose={() => setWikiDialogIndex(null)}
        onSave={(aliases) => {
          if (wikiDialogIndex == null) return
          updateType(wikiDialogIndex, { wikiProjects: aliases })
          setWikiDialogIndex(null)
        }}
        onReloadOptions={reload}
      />
    </div>
  )
}
