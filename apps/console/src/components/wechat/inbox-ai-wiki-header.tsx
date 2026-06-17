import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ResolvedWikiProject } from "@/lib/resolve-inbox-chat-wiki"

type InboxAiWikiHeaderProps = {
  resolved: ResolvedWikiProject[]
  invalidAliases: string[]
  onEditBinding: () => void
}

export function InboxAiWikiHeader({
  resolved,
  invalidAliases,
  onEditBinding,
}: InboxAiWikiHeaderProps) {
  const { t } = useTranslation()
  const labels = resolved.map((p) => p.name || p.alias)
  const labelText = labels.join(", ")

  return (
    <div className="shrink-0 border-b border-[var(--wx-border)]/40 px-3 py-1.5">
      <button
        type="button"
        onClick={onEditBinding}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-[var(--wx-muted)] transition hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]"
        title={t("wechat.aiAssist.wikiHeaderEditHint")}
      >
        <span className="shrink-0 font-medium text-[var(--wx-text)]/80">
          {t("wechat.aiAssist.wikiHeaderLabel")}
        </span>
        <span className="min-w-0 truncate">{labelText}</span>
        {invalidAliases.length > 0 && (
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-amber-400"
            aria-label={t("wechat.aiAssist.wikiPartialInvalid", {
              aliases: invalidAliases.join(", "),
            })}
          />
        )}
      </button>
    </div>
  )
}
