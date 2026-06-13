import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { previewAgentReply } from "@/lib/preview-reply-client"

const TRY_SAMPLES = [
  "退款大概多久到账？",
  "你是不是机器人？",
  "我要投诉，转真人客服",
] as const

export function BrainTryAskPanel() {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof previewAgentReply>
  > | null>(null)

  async function runPreview(q: string) {
    const text = q.trim()
    if (!text) return
    setLoading(true)
    setError(null)
    try {
      setResult(await previewAgentReply(text))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{t("console.brain.tryAskTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("console.brain.tryAskHint")}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("console.brain.tryAskPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runPreview(query)
          }}
        />
        <Button
          size="sm"
          disabled={loading || !query.trim()}
          onClick={() => void runPreview(query)}
        >
          {loading ? t("console.brain.tryAskRunning") : t("console.brain.tryAskRun")}
        </Button>
        <div className="flex flex-wrap gap-1.5">
          {TRY_SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={() => {
                setQuery(s)
                void runPreview(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        {result && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
            <p className="font-mono text-muted-foreground">
              {t("console.brain.tryAskRoute", {
                action: result.action,
                reason: result.reason,
              })}
              {result.source != null && (
                <>
                  {" · "}
                  {result.source}
                  {result.confidence != null
                    ? ` conf=${result.confidence.toFixed(2)}`
                    : ""}
                </>
              )}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed text-foreground">
              {result.answer}
            </p>
            <p
              className={
                result.stealthOk ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
              }
            >
              {result.stealthOk
                ? t("console.brain.tryAskStealthOk")
                : t("console.brain.tryAskStealthFail", {
                    hits: result.bannedHits.join("、"),
                  })}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
