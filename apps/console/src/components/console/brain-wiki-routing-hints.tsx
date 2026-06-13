import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { readConfigFile } from "@/lib/agent-config-client"
import { parseEscalationConfig } from "@/lib/escalation-config"
import { useWikiStore } from "@/stores/wiki-store"

export function BrainWikiRoutingHints() {
  const { t } = useTranslation()
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const [links, setLinks] = useState<{ path: string; note: string }[]>([])

  useEffect(() => {
    void readConfigFile("escalation.json")
      .then((raw) => setLinks(parseEscalationConfig(raw).wikiLinks ?? []))
      .catch(() => setLinks([]))
  }, [selectedFile])

  const matched = useMemo(() => {
    if (!selectedFile || links.length === 0) return []
    const norm = selectedFile.replace(/\\/g, "/").toLowerCase()
    return links.filter((l) =>
      norm.includes(l.path.replace(/\\/g, "/").toLowerCase()),
    )
  }, [links, selectedFile])

  if (matched.length === 0) return null

  return (
    <div className="shrink-0 border-b bg-muted/30 px-4 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("console.brain.kbRoutingHints")}
      </p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {matched.map((l) => (
          <li key={l.path}>
            <span className="font-medium text-foreground">{l.path}</span>
            {" — "}
            {l.note}
          </li>
        ))}
      </ul>
    </div>
  )
}
