import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModuleTabs } from "@/components/console/module-tabs"
import { StatusBadge } from "@/components/console/status-badge"
import { SessionKeyPicker } from "@/components/console/session-key-picker"
import { useModuleTab } from "@/hooks/use-module-tab"
import { readMemoryPersona } from "@/lib/agent-config-client"
import {
  LAYOUT_KEYS,
  MEMORY_TABS,
  type MemoryTab,
} from "@/lib/console-layout"
import {
  fetchMemoryHealth,
  runRecall,
  searchConversations,
  searchMemories,
} from "@/lib/memory-client"
import { CONSOLE_PANEL } from "@/lib/console-ui"
import { useConsoleStore } from "@/stores/console-store"

type MemoryModuleProps = {
  embedded?: boolean
}

export function MemoryModule({ embedded = false }: MemoryModuleProps = {}) {
  const { t } = useTranslation()
  const navigateSystem = useConsoleStore((s) => s.navigateSystem)
  const prefillSessionKey = useConsoleStore((s) => s.prefillSessionKey)
  const pendingMemoryTab = useConsoleStore((s) => s.pendingMemoryTab)
  const consumePrefillSessionKey = useConsoleStore((s) => s.consumePrefillSessionKey)
  const consumePendingMemoryTab = useConsoleStore((s) => s.consumePendingMemoryTab)

  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchMemoryHealth>>>(null)
  const [sessionKey, setSessionKey] = useState("")
  const [recallQuery, setRecallQuery] = useState("用户偏好与相处方式")
  const [recallResult, setRecallResult] = useState<string | null>(null)
  const [conversations, setConversations] = useState<string | null>(null)
  const [memories, setMemories] = useState<string | null>(null)
  const [l3Persona, setL3Persona] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [playgroundAllowed, setPlaygroundAllowed] = useState(false)

  const memoryUp = health?.status === "ok"
  const [activeTab, setActiveTab] = useModuleTab<MemoryTab>({
    storageKey: LAYOUT_KEYS.memoryTab,
    allowed: MEMORY_TABS,
    defaultTab: "playground",
    forcedTab: !memoryUp && !playgroundAllowed ? "overview" : null,
  })

  const loadL3Persona = useCallback(async (chatId: string) => {
    const id = chatId.trim()
    if (!id) {
      setL3Persona("")
      return
    }
    try {
      setL3Persona(await readMemoryPersona(id))
    } catch {
      setL3Persona("")
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    setHealth(await fetchMemoryHealth())
    await loadL3Persona(sessionKey)
    setRefreshing(false)
  }, [loadL3Persona, sessionKey])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void loadL3Persona(sessionKey)
  }, [loadL3Persona, sessionKey])

  useEffect(() => {
    if (!prefillSessionKey && !pendingMemoryTab) return
    const prefill = consumePrefillSessionKey()
    const tab = consumePendingMemoryTab()
    if (prefill) {
      setSessionKey(prefill)
    }
    if (tab) {
      if (tab === "playground") {
        setPlaygroundAllowed(true)
      }
      setActiveTab(tab)
    }
  }, [
    prefillSessionKey,
    pendingMemoryTab,
    consumePrefillSessionKey,
    consumePendingMemoryTab,
    setActiveTab,
  ])

  function handleTabChange(tab: MemoryTab) {
    if (tab === "playground") setPlaygroundAllowed(true)
    setActiveTab(tab)
  }

  async function handleRecall() {
    if (!sessionKey.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await runRecall(sessionKey, recallQuery)
      setRecallResult(JSON.stringify(res, null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadCaptures() {
    if (!sessionKey.trim()) return
    setLoading(true)
    setError(null)
    try {
      const conv = await searchConversations(sessionKey, "最近对话记录", 15)
      setConversations(conv.results?.trim() || t("console.memory.empty"))
      const mem = await searchMemories("用户偏好 重要事实", 8)
      setMemories(mem.results?.trim() || t("console.memory.empty"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const memoryHealth = memoryUp
    ? ("up" as const)
    : health
      ? ("degraded" as const)
      : ("down" as const)

  const tabs = [
    { id: "overview" as const, label: t("console.memory.tabs.overview") },
    { id: "playground" as const, label: t("console.memory.tabs.playground") },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-0 pt-6">
          <div>
            <h1 className="text-xl font-semibold">{t("console.memory.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("console.memory.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("console.refresh")}
          </Button>
        </div>
      )}

      {embedded && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
          <div>
            <h2 className="text-sm font-semibold">{t("console.memory.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("console.memory.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("console.refresh")}
          </Button>
        </div>
      )}

      <ModuleTabs tabs={tabs} active={activeTab} onChange={handleTabChange} />

      {error && (
        <div className="mx-6 mt-4 shrink-0 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive whitespace-pre-wrap">
          {error}
        </div>
      )}

      {activeTab === "overview" && (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="flex max-w-2xl flex-col gap-4">
            <div className={`${CONSOLE_PANEL} text-sm`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t("console.memory.gateway")}</span>
                <StatusBadge
                  health={memoryHealth}
                  label={
                    memoryUp
                      ? t("console.memory.up")
                      : health
                        ? health.status
                        : t("console.memory.down")
                  }
                />
                {health?.version ? (
                  <span className="text-xs text-muted-foreground">v{health.version}</span>
                ) : null}
              </div>
              {!memoryUp && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("console.memory.overviewHint")}
                </p>
              )}
              {!memoryUp && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => navigateSystem("services", "memory")}
                >
                  {t("console.memory.goToStack")}
                </Button>
              )}
            </div>

            <div className={`${CONSOLE_PANEL} space-y-3`}>
              <h2 className="font-medium">{t("console.memory.l3Preview")}</h2>
              <SessionKeyPicker value={sessionKey} onChange={setSessionKey} />
              <pre className="max-h-[min(24rem,50vh)] overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                {!sessionKey.trim()
                  ? t("console.memory.l3SelectChat")
                  : l3Persona.trim() || t("console.memory.l3Empty")}
              </pre>
            </div>
          </div>
        </div>
      )}

      {activeTab === "playground" && (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="flex max-w-3xl flex-col gap-4">
            {!memoryUp && (
              <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                {t("console.memory.playgroundDownHint")}
              </div>
            )}

            <div className={`${CONSOLE_PANEL} space-y-3`}>
              <SessionKeyPicker value={sessionKey} onChange={setSessionKey} />
            </div>

            <div className={`${CONSOLE_PANEL} space-y-3`}>
              <h2 className="font-medium">{t("console.memory.tryRecall")}</h2>
              <Input
                value={recallQuery}
                onChange={(e) => setRecallQuery(e.target.value)}
                placeholder={t("console.memory.recallQuery")}
              />
              <Button
                disabled={loading || !sessionKey.trim()}
                onClick={() => void handleRecall()}
              >
                {loading ? t("console.memory.running") : t("console.memory.runRecall")}
              </Button>
              {recallResult && (
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                  {recallResult}
                </pre>
              )}
            </div>

            <div className={`${CONSOLE_PANEL} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{t("console.memory.captureSection")}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading || !sessionKey.trim()}
                  onClick={() => void loadCaptures()}
                >
                  {t("console.memory.loadCaptures")}
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm text-muted-foreground">
                    {t("console.memory.conversations")}
                  </h3>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                    {conversations ?? "—"}
                  </pre>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm text-muted-foreground">
                    {t("console.memory.memories")}
                  </h3>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                    {memories ?? "—"}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
