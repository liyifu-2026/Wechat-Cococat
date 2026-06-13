import { useCallback, useEffect, useState } from "react"
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  listEscalationMutes,
  readConfigFile,
  unmuteEscalationChat,
  writeConfigFile,
  type EscalationMuteEntry,
} from "@/lib/agent-config-client"
import { fetchDriverChats, type DriverChat } from "@/lib/driver-client"
import {
  DEFAULT_ESCALATION,
  parseEscalationConfig,
  type EscalationConfigFile,
  type EscalationWikiLink,
} from "@/lib/escalation-config"
import { CONSOLE_PANEL } from "@/lib/console-ui"

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0m"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.ceil((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function AgentEscalationTab() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<EscalationConfigFile>(DEFAULT_ESCALATION)
  const [mutes, setMutes] = useState<EscalationMuteEntry[]>([])
  const [contacts, setContacts] = useState<DriverChat[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [raw, muteList, chats] = await Promise.all([
        readConfigFile("escalation.json"),
        listEscalationMutes(),
        fetchDriverChats(80).catch(() => [] as DriverChat[]),
      ])
      setConfig(parseEscalationConfig(raw))
      setMutes(muteList)
      setContacts(chats.filter((c) => !c.isGroup))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function saveConfig() {
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        ...config,
        wikiLinks: (config.wikiLinks ?? []).filter(
          (l) => l.path.trim() && l.note.trim(),
        ),
      }
      const text = JSON.stringify(payload, null, 2) + "\n"
      await writeConfigFile("escalation.json", text)
      setMessage(t("console.agent.escalation.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleUnmute(chatId: string) {
    setError(null)
    try {
      await unmuteEscalationChat(chatId)
      setMutes((prev) => prev.filter((m) => m.chat_id !== chatId))
      setMessage(t("console.agent.escalation.unmuted"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function pickMaintainer(chat: DriverChat) {
    setConfig((prev) => ({
      ...prev,
      maintainer: {
        chatId: chat.id,
        displayName: chat.remark || chat.name || chat.username || chat.id,
      },
    }))
  }

  function updateWikiLink(index: number, patch: Partial<EscalationWikiLink>) {
    setConfig((prev) => {
      const links = [...(prev.wikiLinks ?? [])]
      const row = links[index]
      if (!row) return prev
      links[index] = { ...row, ...patch }
      return { ...prev, wikiLinks: links }
    })
  }

  function addWikiLink() {
    setConfig((prev) => ({
      ...prev,
      wikiLinks: [...(prev.wikiLinks ?? []), { path: "", note: "" }],
    }))
  }

  function removeWikiLink(index: number) {
    setConfig((prev) => ({
      ...prev,
      wikiLinks: (prev.wikiLinks ?? []).filter((_, i) => i !== index),
    }))
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("console.agent.escalation.hint")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void loadAll()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("console.refresh")}
        </Button>
      </div>

      {message && (
        <div className="mb-4 rounded-md border px-4 py-2 text-sm">{message}</div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid max-w-3xl gap-4">
        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.escalation.maintainer")}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>{t("console.agent.escalation.chatId")}</Label>
              <Input
                value={config.maintainer.chatId}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    maintainer: { ...p.maintainer, chatId: e.target.value },
                  }))
                }
                placeholder="wxid_…"
              />
            </div>
            <div>
              <Label>{t("console.agent.escalation.displayName")}</Label>
              <Input
                value={config.maintainer.displayName}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    maintainer: { ...p.maintainer, displayName: e.target.value },
                  }))
                }
              />
            </div>
          </div>
          {contacts.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-auto text-sm">
              {contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full rounded-md px-2 py-1 text-left hover:bg-accent"
                  onClick={() => pickMaintainer(c)}
                >
                  {c.remark || c.name || c.username || c.id}
                  <span className="ml-2 text-xs text-muted-foreground">{c.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`${CONSOLE_PANEL} space-y-2`}>
          <h2 className="font-medium">{t("console.agent.escalation.notify")}</h2>
          {(
            [
              ["escalate", "notifyEscalate"],
              ["probeLoop", "notifyProbe"],
              ["lowConfidence", "notifyLowConfidence"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.notifyOn[key]}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    notifyOn: { ...p.notifyOn, [key]: e.target.checked },
                  }))
                }
              />
              {t(`console.agent.escalation.${labelKey}`)}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.triage.useLlm}
              onChange={(e) =>
                setConfig((p) => ({
                  ...p,
                  triage: { useLlm: e.target.checked },
                }))
              }
            />
            {t("console.agent.escalation.useLlm")}
          </label>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.escalation.lines")}</h2>
          <div>
            <Label>{t("console.agent.escalation.deflectLine")}</Label>
            <Input
              value={config.deflectLine}
              onChange={(e) =>
                setConfig((p) => ({ ...p, deflectLine: e.target.value }))
              }
            />
          </div>
          <div>
            <Label>{t("console.agent.escalation.customerLine")}</Label>
            <Input
              value={config.customerLine}
              onChange={(e) =>
                setConfig((p) => ({ ...p, customerLine: e.target.value }))
              }
            />
          </div>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">
                {t("console.agent.escalation.wikiLinksTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("console.agent.escalation.wikiLinksHint")}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addWikiLink}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("console.agent.escalation.wikiLinksAdd")}
            </Button>
          </div>
          {(config.wikiLinks ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("console.agent.escalation.wikiLinksEmpty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {(config.wikiLinks ?? []).map((link, index) => (
                <li
                  key={`${index}-${link.path}`}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <div>
                    <Label className="text-xs">
                      {t("console.agent.escalation.wikiLinksPath")}
                    </Label>
                    <Input
                      value={link.path}
                      onChange={(e) =>
                        updateWikiLink(index, { path: e.target.value })
                      }
                      placeholder="faq/refund.md"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      {t("console.agent.escalation.wikiLinksNote")}
                    </Label>
                    <Input
                      value={link.note}
                      onChange={(e) =>
                        updateWikiLink(index, { note: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t("console.agent.escalation.wikiLinksRemove")}
                      onClick={() => removeWikiLink(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button className="w-fit" onClick={() => void saveConfig()} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {t("console.agent.save")}
        </Button>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.escalation.muteList")}</h2>
          {mutes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("console.agent.escalation.noMutes")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {mutes.map((m) => (
                <li
                  key={m.chat_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div>
                    <div className="font-medium">{m.chat_name || m.chat_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.reason} · {formatRemaining(m.muted_until - Date.now())}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleUnmute(m.chat_id)}
                  >
                    {t("console.agent.escalation.unmute")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
