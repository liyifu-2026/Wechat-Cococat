import { useCallback, useEffect, useState } from "react"
import { FolderOpen } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { openProject } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { ensureAndBindAgentChatDir } from "@/lib/agent-config-client"
import {
  loadWikiBindPickerOptions,
  type WikiBindPickerOption,
} from "@/lib/inbox-wiki-bind-options"
import { ensureProjectId } from "@/lib/project-identity"
import { upsertWikiRegistryEntry } from "@/lib/wiki-registry-sync"
import { normalizePath } from "@/lib/path-utils"

type InboxAiWikiBindPickerProps = {
  chatId: string
  initialSelected?: string[]
  onSaved: () => void
  onCancel?: () => void
}

function aliasForOption(
  option: WikiBindPickerOption,
  selectedPaths: Set<string>,
): boolean {
  return selectedPaths.has(option.projectPath)
}

export function InboxAiWikiBindPicker({
  chatId,
  initialSelected = [],
  onSaved,
  onCancel,
}: InboxAiWikiBindPickerProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<WikiBindPickerOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadOptions = useCallback(async () => {
    setLoadingOptions(true)
    try {
      const loaded = await loadWikiBindPickerOptions()
      setOptions(loaded)
      const pathByAlias = new Map<string, string>()
      for (const opt of loaded) {
        pathByAlias.set(opt.alias, opt.projectPath)
      }
      const paths = new Set<string>()
      for (const alias of initialSelected) {
        const path = pathByAlias.get(alias)
        if (path) paths.add(path)
      }
      setSelectedPaths(paths)
    } finally {
      setLoadingOptions(false)
    }
  }, [initialSelected])

  useEffect(() => {
    void reloadOptions()
  }, [reloadOptions])

  const selectedCount = selectedPaths.size
  const canSave = selectedCount > 0 && !saving

  const togglePath = (projectPath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(projectPath)) next.delete(projectPath)
      else next.add(projectPath)
      return next
    })
  }

  async function handleOpenFolder() {
    setOpening(true)
    setError(null)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("welcome.openProject"),
      })
      if (!selected) return
      const project = await openProject(selected)
      const projectPath = normalizePath(project.path)
      const projectId = project.id || (await ensureProjectId(projectPath))
      await upsertWikiRegistryEntry(projectPath, projectId)
      await reloadOptions()
      setSelectedPaths((prev) => new Set(prev).add(projectPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const chosen = options.filter((opt) => selectedPaths.has(opt.projectPath))
      const aliases: string[] = []
      for (const opt of chosen) {
        if (opt.registered) {
          aliases.push(opt.alias)
        } else {
          const alias = await upsertWikiRegistryEntry(opt.projectPath, opt.projectId)
          aliases.push(alias)
        }
      }
      await ensureAndBindAgentChatDir(
        chatId,
        `${JSON.stringify({ projects: aliases }, null, 2)}\n`,
      )
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const emptyOptions = !loadingOptions && options.length === 0

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {loadingOptions ? (
        <p className="text-center text-sm text-[var(--wx-muted)]">
          {t("wechat.aiAssist.wikiPickerLoading")}
        </p>
      ) : emptyOptions ? (
        <p className="text-center text-sm text-[var(--wx-muted)]">
          {t("wechat.aiAssist.wikiPickerEmpty")}
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-[var(--wx-border)]/60 p-1">
          {options.map((opt) => {
            const checked = aliasForOption(opt, selectedPaths)
            return (
              <li key={opt.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--wx-list-hover)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    onChange={() => togglePath(opt.projectPath)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--wx-text)]">
                      {opt.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--wx-muted)]">
                      {opt.alias}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {saving
            ? t("wechat.aiAssist.wikiBindSaving")
            : t("wechat.aiAssist.wikiBindAction")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={opening}
          onClick={() => void handleOpenFolder()}
        >
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          {t("wechat.aiAssist.wikiBindBrowse")}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t("wechat.aiAssist.wikiBindCancel")}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
