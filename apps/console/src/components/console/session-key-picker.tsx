import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { listAgentChats, type AgentChatSummary } from "@/lib/agent-config-client"
import { fetchDriverChats, type DriverChat } from "@/lib/driver-client"

interface SessionKeyPickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
}

function mergeSessions(
  agentChats: AgentChatSummary[],
  driverChats: DriverChat[],
): { id: string; label: string }[] {
  const map = new Map<string, string>()
  for (const c of agentChats) {
    map.set(c.chat_id, c.chat_id)
  }
  for (const c of driverChats) {
    const label = c.name ?? c.username ?? c.id
    map.set(c.id, `${label} (${c.id})`)
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function SessionKeyPicker({ id = "session-key", value, onChange }: SessionKeyPickerProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ id: string; label: string }[]>([])

  useEffect(() => {
    void (async () => {
      const agent = await listAgentChats().catch(() => [] as AgentChatSummary[])
      const driver = await fetchDriverChats(50).catch(() => [] as DriverChat[])
      setOptions(mergeSessions(agent, driver))
    })()
  }, [])

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("console.memory.sessionKey")}</Label>
      {options.length > 0 ? (
        <select
          id={id}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t("console.memory.selectSession")}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : null}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="12345678@chatroom"
      />
    </div>
  )
}
