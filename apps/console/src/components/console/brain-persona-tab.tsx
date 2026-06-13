import { useCallback, useEffect, useRef, useState } from "react"
import { Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import { STEALTH_BANNED_WORDS, checkStealthText } from "@/lib/stealth-check"

export function BrainPersonaTab() {
  const { t } = useTranslation()
  const [persona, setPersona] = useState("")
  const savedRef = useRef("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const p = await readConfigFile("persona.md")
      setPersona(p)
      savedRef.current = p
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await writeConfigFile("persona.md", persona)
      savedRef.current = persona
      setMessage(t("console.brain.personaSaved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const draftStealth = checkStealthText(persona)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4">
      {message && (
        <div className="mb-3 rounded-md border px-4 py-2 text-sm">{message}</div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-md border bg-muted/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("console.brain.stealthTitle")}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("console.brain.stealthHint")}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {STEALTH_BANNED_WORDS.map((w) => (
            <span
              key={w}
              className="rounded border border-dashed border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[10px] text-destructive"
            >
              {w}
            </span>
          ))}
        </div>
        {!draftStealth.ok && persona.trim() && (
          <p className="mt-2 text-xs text-destructive">
            {t("console.brain.stealthDraftFail", {
              hits: draftStealth.hits.join("、"),
            })}
          </p>
        )}
      </div>

      <Label htmlFor="brain-persona" className="mb-2 shrink-0">
        {t("console.brain.personaLabel")}
      </Label>
      <textarea
        id="brain-persona"
        className="min-h-[200px] flex-1 resize-y rounded-lg border bg-background p-3 font-mono text-sm leading-relaxed"
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        placeholder={t("console.agent.personaPlaceholder")}
      />
      <div className="mt-3 flex shrink-0 gap-2 border-t border-border pt-3">
        <Button onClick={() => void save()} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {t("console.agent.save")}
        </Button>
        <Button
          variant="outline"
          disabled={saving || persona === savedRef.current}
          onClick={() => setPersona(savedRef.current)}
        >
          {t("console.agent.reset")}
        </Button>
      </div>
    </div>
  )
}
