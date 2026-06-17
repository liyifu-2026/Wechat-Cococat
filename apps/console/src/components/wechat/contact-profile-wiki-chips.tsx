import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ensureAndBindAgentChatDir } from "@/lib/agent-config-client"
import {
  loadWikiBindPickerOptions,
  type WikiBindPickerOption,
} from "@/lib/inbox-wiki-bind-options"
import { upsertWikiRegistryEntry } from "@/lib/wiki-registry-sync"
import { cn } from "@/lib/utils"

type ContactProfileWikiChipsProps = {
  chatId: string
  selectedAliases: string[]
  onChanged: () => void
}

export function ContactProfileWikiChips({
  chatId,
  selectedAliases,
  onChanged,
}: ContactProfileWikiChipsProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<WikiBindPickerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setOptions(await loadWikiBindPickerOptions())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selectedSet = new Set(selectedAliases)

  async function persistAliases(aliases: string[]) {
    setSaving(true)
    try {
      await ensureAndBindAgentChatDir(
        chatId,
        `${JSON.stringify({ projects: aliases }, null, 2)}\n`,
      )
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function toggle(opt: WikiBindPickerOption) {
    if (saving) return
    const next = new Set(selectedAliases)
    if (next.has(opt.alias)) {
      next.delete(opt.alias)
    } else {
      next.add(opt.alias)
    }
    const chosen = options.filter((o) => next.has(o.alias))
    const aliases: string[] = []
    for (const row of chosen) {
      if (row.registered) {
        aliases.push(row.alias)
      } else {
        aliases.push(await upsertWikiRegistryEntry(row.projectPath, row.projectId))
      }
    }
    await persistAliases(aliases)
    await reload()
  }

  if (loading) {
    return (
      <span className="text-xs text-[var(--wx-muted)]">
        {t("wechat.contacts.wikiLoading")}
      </span>
    )
  }

  if (options.length === 0) {
    return (
      <span className="text-xs text-[var(--wx-muted)]">
        {t("wechat.contacts.wikiUnbound")}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {options.map((opt) => {
        const active = selectedSet.has(opt.alias)
        return (
          <button
            key={opt.key}
            type="button"
            disabled={saving}
            title={opt.name}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] transition disabled:opacity-50",
              active
                ? "border-[var(--wx-accent)] bg-[var(--wx-accent)]/15 text-[var(--wx-text)]"
                : "border-[var(--wx-border)] text-[var(--wx-muted)] hover:border-[var(--wx-accent)]",
            )}
            onClick={() => void toggle(opt)}
          >
            {opt.alias}
          </button>
        )
      })}
    </div>
  )
}
