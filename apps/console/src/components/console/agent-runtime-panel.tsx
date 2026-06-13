import { useCallback, useEffect, useState } from "react"
import { Plus, Save, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import {
  applyAgentEnvVars,
  getEnvVar,
  parseEnvFile,
} from "@/lib/agent-env"
import {
  DEFAULT_SCHEDULES,
  parseSchedules,
  type ScheduleJob,
  type SchedulesFile,
} from "@/lib/schedules-config"
import { CONSOLE_PANEL } from "@/lib/console-ui"

type ThoughtfulAckGlobal = "off" | "default" | "custom"

type AgentRuntimePanelProps = {
  embedded?: boolean
}

export function AgentRuntimePanel({
  embedded = false,
}: AgentRuntimePanelProps = {}) {
  const { t } = useTranslation()
  const [redisUrl, setRedisUrl] = useState("")
  const [queueEnabled, setQueueEnabled] = useState("")
  const [queueConcurrency, setQueueConcurrency] = useState("")
  const [replyCooldownMs, setReplyCooldownMs] = useState("")
  const [thoughtfulAck, setThoughtfulAck] = useState<ThoughtfulAckGlobal>("off")
  const [thoughtfulAckCustom, setThoughtfulAckCustom] = useState("")
  const [thoughtfulReflect, setThoughtfulReflect] = useState(false)
  const [schedules, setSchedules] = useState<SchedulesFile>(DEFAULT_SCHEDULES)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingEnv, setSavingEnv] = useState(false)
  const [savingSchedules, setSavingSchedules] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [envRaw, schedulesRaw] = await Promise.all([
        readConfigFile("agent.env").catch(() => ""),
        readConfigFile("schedules.json").catch(() => ""),
      ])
      const lines = parseEnvFile(envRaw)
      setRedisUrl(getEnvVar(lines, "REDIS_URL") ?? "")
      setQueueEnabled(getEnvVar(lines, "QUEUE_ENABLED") ?? "")
      setQueueConcurrency(getEnvVar(lines, "QUEUE_CONCURRENCY") ?? "")
      setReplyCooldownMs(getEnvVar(lines, "WECHAT_REPLY_COOLDOWN_MS") ?? "")

      const ack = getEnvVar(lines, "WECHAT_THOUGHTFUL_ACK") ?? ""
      if (ack === "true" || ack === "1") {
        setThoughtfulAck("default")
        setThoughtfulAckCustom("")
      } else if (ack.trim()) {
        setThoughtfulAck("custom")
        setThoughtfulAckCustom(ack)
      } else {
        setThoughtfulAck("off")
        setThoughtfulAckCustom("")
      }

      const reflect = getEnvVar(lines, "WECHAT_THOUGHTFUL_REFLECT") ?? ""
      setThoughtfulReflect(reflect === "true" || reflect === "1")

      setSchedules(parseSchedules(schedulesRaw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveEnv() {
    setSavingEnv(true)
    setMessage(null)
    setError(null)
    try {
      const raw = await readConfigFile("agent.env").catch(() => "")
      let patch: Record<string, string> = {
        REDIS_URL: redisUrl.trim(),
        QUEUE_ENABLED: queueEnabled.trim(),
        QUEUE_CONCURRENCY: queueConcurrency.trim(),
        WECHAT_REPLY_COOLDOWN_MS: replyCooldownMs.trim(),
        WECHAT_THOUGHTFUL_REFLECT: thoughtfulReflect ? "true" : "",
      }
      if (thoughtfulAck === "default") {
        patch.WECHAT_THOUGHTFUL_ACK = "true"
      } else if (thoughtfulAck === "custom" && thoughtfulAckCustom.trim()) {
        patch.WECHAT_THOUGHTFUL_ACK = thoughtfulAckCustom.trim()
      } else {
        patch.WECHAT_THOUGHTFUL_ACK = ""
      }
      await writeConfigFile("agent.env", applyAgentEnvVars(raw, patch))
      setMessage(t("console.agent.runtime.envSaved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingEnv(false)
    }
  }

  async function saveSchedules() {
    setSavingSchedules(true)
    setMessage(null)
    setError(null)
    try {
      const text = JSON.stringify(schedules, null, 2) + "\n"
      await writeConfigFile("schedules.json", text)
      setMessage(t("console.agent.runtime.schedulesSaved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingSchedules(false)
    }
  }

  function updateJob(index: number, patch: Partial<ScheduleJob>) {
    setSchedules((prev) => ({
      ...prev,
      jobs: prev.jobs.map((j, i) => (i === index ? { ...j, ...patch } : j)),
    }))
  }

  function addJob() {
    setSchedules((prev) => ({
      ...prev,
      jobs: [
        ...prev.jobs,
        {
          id: `job-${Date.now()}`,
          chatId: "",
          cron: "0 9 * * *",
          prompt: "",
          enabled: false,
        },
      ],
    }))
  }

  function removeJob(index: number) {
    setSchedules((prev) => ({
      ...prev,
      jobs: prev.jobs.filter((_, i) => i !== index),
    }))
  }

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
            {t("console.system.advanced.agentHint")}
          </p>
        )}

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.runtime.queueTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("console.agent.runtime.queueHint")}
          </p>
          <div className="space-y-1">
            <Label>{t("console.agent.runtime.redisUrl")}</Label>
            <Input
              value={redisUrl}
              onChange={(e) => setRedisUrl(e.target.value)}
              placeholder="redis://127.0.0.1:6379"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("console.agent.runtime.queueEnabled")}</Label>
              <Input
                value={queueEnabled}
                onChange={(e) => setQueueEnabled(e.target.value)}
                placeholder="true"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("console.agent.runtime.queueConcurrency")}</Label>
              <Input
                value={queueConcurrency}
                onChange={(e) => setQueueConcurrency(e.target.value)}
                placeholder="4"
              />
            </div>
          </div>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.runtime.replyTitle")}</h2>
          <div className="space-y-1">
            <Label>{t("console.agent.runtime.globalCooldown")}</Label>
            <Input
              type="number"
              min={0}
              step={1000}
              value={replyCooldownMs}
              onChange={(e) => setReplyCooldownMs(e.target.value)}
              placeholder="30000"
            />
          </div>
          <div className="space-y-1">
            <Label>{t("console.agent.runtime.thoughtfulAck")}</Label>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={thoughtfulAck}
              onChange={(e) =>
                setThoughtfulAck(e.target.value as ThoughtfulAckGlobal)
              }
            >
              <option value="off">{t("console.inbox.styleAckOff")}</option>
              <option value="default">{t("console.inbox.styleAckDefault")}</option>
              <option value="custom">{t("console.inbox.styleAckCustom")}</option>
            </select>
            {thoughtfulAck === "custom" && (
              <Input
                className="mt-2"
                value={thoughtfulAckCustom}
                onChange={(e) => setThoughtfulAckCustom(e.target.value)}
                placeholder={t("console.inbox.styleAckPlaceholder")}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={thoughtfulReflect}
              onChange={(e) => setThoughtfulReflect(e.target.checked)}
            />
            {t("console.agent.runtime.thoughtfulReflect")}
          </label>
          <Button
            className="w-fit"
            onClick={() => void saveEnv()}
            disabled={savingEnv}
          >
            <Save className="mr-2 h-4 w-4" />
            {t("console.agent.runtime.saveEnv")}
          </Button>
        </div>

        <div className={`${CONSOLE_PANEL} space-y-3`}>
          <h2 className="font-medium">{t("console.agent.runtime.schedulesTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("console.agent.runtime.schedulesHint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("console.agent.runtime.quietStart")}</Label>
              <Input
                value={schedules.quietHours?.start ?? ""}
                onChange={(e) =>
                  setSchedules((prev) => ({
                    ...prev,
                    quietHours: {
                      start: e.target.value,
                      end: prev.quietHours?.end ?? "08:00",
                    },
                  }))
                }
                placeholder="23:00"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("console.agent.runtime.quietEnd")}</Label>
              <Input
                value={schedules.quietHours?.end ?? ""}
                onChange={(e) =>
                  setSchedules((prev) => ({
                    ...prev,
                    quietHours: {
                      start: prev.quietHours?.start ?? "23:00",
                      end: e.target.value,
                    },
                  }))
                }
                placeholder="08:00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("console.agent.runtime.jobs")}</Label>
              <Button size="sm" variant="outline" onClick={addJob}>
                <Plus className="mr-1 h-3 w-3" />
                {t("console.agent.runtime.addJob")}
              </Button>
            </div>
            {schedules.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("console.agent.runtime.noJobs")}
              </p>
            ) : (
              <ul className="space-y-3">
                {schedules.jobs.map((job, index) => (
                  <li key={job.id || index} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={job.enabled}
                          onChange={(e) =>
                            updateJob(index, { enabled: e.target.checked })
                          }
                        />
                        {t("console.agent.runtime.jobEnabled")}
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeJob(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      value={job.id}
                      onChange={(e) => updateJob(index, { id: e.target.value })}
                      placeholder="job-id"
                    />
                    <Input
                      value={job.chatId}
                      onChange={(e) => updateJob(index, { chatId: e.target.value })}
                      placeholder="12345@chatroom"
                    />
                    <Input
                      value={job.cron}
                      onChange={(e) => updateJob(index, { cron: e.target.value })}
                      placeholder="0 9 * * *"
                    />
                    <textarea
                      className="min-h-[60px] w-full rounded-md border bg-background p-2 text-sm"
                      value={job.prompt}
                      onChange={(e) => updateJob(index, { prompt: e.target.value })}
                      placeholder={t("console.agent.runtime.jobPrompt")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            className="w-fit"
            onClick={() => void saveSchedules()}
            disabled={savingSchedules}
          >
            <Save className="mr-2 h-4 w-4" />
            {t("console.agent.runtime.saveSchedules")}
          </Button>
        </div>
      </div>
    </div>
  )
}
