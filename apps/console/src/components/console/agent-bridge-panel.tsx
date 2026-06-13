import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import { CONSOLE_PANEL } from "@/lib/console-ui"

type BridgePolicy = {
  require_mention?: boolean
  reply_with_mention?: string | boolean
}

type BridgeFile = Record<string, BridgePolicy>

const DEFAULT_BRIDGE: BridgeFile = {
  "*": { require_mention: true, reply_with_mention: "none" },
}

function parseBridge(raw: string): BridgeFile {
  if (!raw.trim()) return DEFAULT_BRIDGE
  return JSON.parse(raw) as BridgeFile
}

type AgentBridgePanelProps = {
  embedded?: boolean
}

export function AgentBridgePanel({ embedded = false }: AgentBridgePanelProps = {}) {
  const { t } = useTranslation()
  const [bridgeRaw, setBridgeRaw] = useState("")
  const [bridge, setBridge] = useState<BridgeFile>(DEFAULT_BRIDGE)
  const [newGroupId, setNewGroupId] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const b = await readConfigFile("bridge-groups.json")
      setBridgeRaw(b)
      try {
        setBridge(parseBridge(b))
      } catch {
        setBridge(DEFAULT_BRIDGE)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveBridge() {
    setSaving(true)
    setMessage(null)
    try {
      const text = JSON.stringify(bridge, null, 2) + "\n"
      await writeConfigFile("bridge-groups.json", text)
      setBridgeRaw(text)
      setMessage(t("console.agent.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function updateWildcard(patch: Partial<BridgePolicy>) {
    setBridge((prev) => ({
      ...prev,
      "*": { ...prev["*"], ...patch },
    }))
  }

  function addGroupOverride() {
    const id = newGroupId.trim()
    if (!id || id === "*") return
    setBridge((prev) => ({
      ...prev,
      [id]: prev[id] ?? {
        require_mention: prev["*"]?.require_mention ?? true,
        reply_with_mention: prev["*"]?.reply_with_mention ?? "none",
      },
    }))
    setNewGroupId("")
  }

  function removeOverride(id: string) {
    setBridge((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const overrides = Object.entries(bridge).filter(([k]) => k !== "*")

  return (
    <div
      className={
        embedded
          ? "min-h-0 flex-1 overflow-auto px-8 py-6"
          : "min-h-0 flex-1 overflow-auto px-6 py-4"
      }
    >
      {message && (
        <div className="mb-4 rounded-md border px-4 py-2 text-sm">{message}</div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex max-w-2xl flex-col gap-4">
        {!embedded && (
          <p className="text-sm text-muted-foreground">
            {t("console.system.advanced.bridgeHint")}
          </p>
        )}

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.bridgeDefault")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bridge["*"]?.require_mention ?? true}
              onChange={(e) => updateWildcard({ require_mention: e.target.checked })}
            />
            {t("console.agent.requireMention")}
          </label>
          <div className="space-y-1">
            <Label>{t("console.agent.replyMention")}</Label>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={String(bridge["*"]?.reply_with_mention ?? "none")}
              onChange={(e) =>
                updateWildcard({ reply_with_mention: e.target.value })
              }
            >
              <option value="trigger">trigger</option>
              <option value="all">all</option>
              <option value="none">none</option>
            </select>
          </div>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.bridgeOverrides")}</h2>
          <div className="flex gap-2">
            <Input
              value={newGroupId}
              onChange={(e) => setNewGroupId(e.target.value)}
              placeholder="12345@chatroom"
            />
            <Button variant="outline" onClick={addGroupOverride}>
              {t("console.agent.addGroup")}
            </Button>
          </div>
          {overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("console.agent.noOverrides")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {overrides.map(([id, policy]) => (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                >
                  <code className="text-xs">{id}</code>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={policy.require_mention ?? true}
                      onChange={(e) =>
                        setBridge((prev) => ({
                          ...prev,
                          [id]: { ...prev[id], require_mention: e.target.checked },
                        }))
                      }
                    />
                    @
                  </label>
                  <select
                    className="rounded border bg-background px-1 py-0.5 text-xs"
                    value={String(policy.reply_with_mention ?? "none")}
                    onChange={(e) =>
                      setBridge((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], reply_with_mention: e.target.value },
                      }))
                    }
                  >
                    <option value="trigger">trigger</option>
                    <option value="all">all</option>
                    <option value="none">none</option>
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeOverride(id)}
                  >
                    {t("console.agent.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {t("console.agent.rawJson")}
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2">
            {bridgeRaw}
          </pre>
        </details>

        <Button className="w-fit" onClick={() => void saveBridge()} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {t("console.agent.save")}
        </Button>
      </div>
    </div>
  )
}
