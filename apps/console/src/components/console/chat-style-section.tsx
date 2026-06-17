import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  listAgentChats,
  readAgentChatFile,
  writeAgentChatFile,
} from "@/lib/agent-config-client"
import {
  DEFAULT_CHAT_STYLE_FORM,
  parseChatStyle,
  serializeChatStyle,
  type ChatStyleForm,
} from "@/lib/chat-style"

type ChatStyleSectionProps = {
  chatId: string
}

export function ChatStyleSection({ chatId }: ChatStyleSectionProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ChatStyleForm>(DEFAULT_CHAT_STYLE_FORM)
  const [raw, setRaw] = useState("")
  const [dirName, setDirName] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!chatId) return
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const chats = await listAgentChats().catch(() => [])
      const summary = chats.find((c) => c.chat_id === chatId)
      if (!summary) {
        setDirName(null)
        setForm(DEFAULT_CHAT_STYLE_FORM)
        setRaw("")
        return
      }
      setDirName(summary.dir_name)
      const styleRaw = await readAgentChatFile(summary.dir_name, "style.json")
      setRaw(styleRaw)
      setForm(parseChatStyle(styleRaw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!dirName) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const text = serializeChatStyle(form, raw)
      await writeAgentChatFile(dirName, "style.json", text)
      setRaw(text)
      setMessage(t("console.agent.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function patch(patch: Partial<ChatStyleForm>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  if (loading) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {t("wechat.inbox.styleLoading")}
      </p>
    )
  }

  if (!dirName) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {t("wechat.inbox.styleNoChat")}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {message && (
        <p className="text-xs text-foreground">{message}</p>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="space-y-1">
        <Label className="text-[11px]">{t("wechat.inbox.styleReplyMode")}</Label>
        <select
          className="wx-themed-select w-full rounded-md border px-2 py-1 text-xs"
          value={form.replyMode}
          onChange={(e) =>
            patch({ replyMode: e.target.value as ChatStyleForm["replyMode"] })
          }
        >
          <option value="">{t("wechat.inbox.styleReplyModeAuto")}</option>
          <option value="fast">{t("wechat.inbox.styleReplyModeFast")}</option>
          <option value="thoughtful">
            {t("wechat.inbox.styleReplyModeThoughtful")}
          </option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">
            {t("wechat.inbox.styleCooldown")}
          </Label>
          <Input
            type="number"
            min={0}
            step={1000}
            className="h-7 text-xs"
            value={form.replyCooldownMs}
            onChange={(e) =>
              patch({ replyCooldownMs: Number(e.target.value) || 0 })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">
            {t("wechat.inbox.styleMaxSends")}
          </Label>
          <Input
            type="number"
            min={1}
            max={5}
            className="h-7 text-xs"
            value={form.maxSendsPerTurn}
            onChange={(e) =>
              patch({
                maxSendsPerTurn: Math.min(
                  5,
                  Math.max(1, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">{t("wechat.inbox.styleAck")}</Label>
        <select
          className="wx-themed-select w-full rounded-md border px-2 py-1 text-xs"
          value={form.thoughtfulAck}
          onChange={(e) =>
            patch({
              thoughtfulAck: e.target.value as ChatStyleForm["thoughtfulAck"],
            })
          }
        >
          <option value="off">{t("wechat.inbox.styleAckOff")}</option>
          <option value="default">{t("wechat.inbox.styleAckDefault")}</option>
          <option value="custom">{t("wechat.inbox.styleAckCustom")}</option>
        </select>
        {form.thoughtfulAck === "custom" && (
          <Input
            className="mt-1 h-7 text-xs"
            value={form.thoughtfulAckCustom}
            placeholder={t("wechat.inbox.styleAckPlaceholder")}
            onChange={(e) => patch({ thoughtfulAckCustom: e.target.value })}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.thoughtfulReflect}
          onChange={(e) => patch({ thoughtfulReflect: e.target.checked })}
        />
        {t("wechat.inbox.styleReflect")}
      </label>

      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={saving}
        onClick={() => void save()}
      >
        <Save className="mr-1 h-3 w-3" />
        {t("console.agent.save")}
      </Button>
    </div>
  )
}
