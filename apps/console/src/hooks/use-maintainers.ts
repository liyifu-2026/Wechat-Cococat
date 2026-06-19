import { useCallback, useEffect, useState } from "react"
import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client"
import { sendDriverMessage } from "@/lib/driver-client"
import {
  applyAllRegisteredWikiToChat,
  ensureMaintainerCustomerType,
  MAINTAINER_CUSTOMER_TYPE_ID,
} from "@/lib/customer-types"
import {
  parseEscalationConfig,
  serializeEscalationConfig,
  type MaintainerInfo,
} from "@/lib/escalation-config"
import { patchChatProfile } from "@/lib/inbox-profile"

const POLL_MS = 30_000

function formatMaintainerWelcomeMenu(): string {
  return [
    "【维护菜单】",
    "你已设为维护人",
    "列表·看客户",
    "已处理·解除",
    "菜单·本帮助",
    "记忆·查客户",
  ].join("\n")
}

export function useMaintainers() {
  const [maintainers, setMaintainers] = useState<MaintainerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const raw = await readConfigFile("escalation.json")
      setMaintainers(parseEscalationConfig(raw).maintainers)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useVisibilityGatedInterval(() => void reload(), POLL_MS, {
    allowedModules: ["inbox", "overview"],
    degradedIntervalMs: 120_000,
    suspendWhenHidden: true,
  })

  const persist = useCallback(async (next: MaintainerInfo[]) => {
    const raw = await readConfigFile("escalation.json").catch(() => "")
    const config = parseEscalationConfig(raw)
    const serialized = serializeEscalationConfig({
      ...config,
      maintainers: next,
    })
    await writeConfigFile(
      "escalation.json",
      JSON.stringify(serialized, null, 2) + "\n",
    )
    setMaintainers(serialized.maintainers)
  }, [])

  const addMaintainer = useCallback(
    async (info: MaintainerInfo) => {
      const chatId = info.chatId.trim()
      if (!chatId) return
      if (maintainers.some((m) => m.chatId === chatId)) return
      await ensureMaintainerCustomerType()
      await persist([
        ...maintainers,
        {
          chatId,
          displayName: info.displayName.trim() || chatId,
        },
      ])
      await patchChatProfile(chatId, {
        userType: MAINTAINER_CUSTOMER_TYPE_ID,
      }).catch(() => {})
      await applyAllRegisteredWikiToChat(chatId).catch(() => {})
      const sent = await sendDriverMessage({
        chatId,
        text: formatMaintainerWelcomeMenu(),
      })
      if (!sent.success) {
        throw new Error(sent.error ?? "failed to send maintainer menu")
      }
    },
    [maintainers, persist],
  )

  const removeMaintainer = useCallback(
    async (chatId: string) => {
      await persist(maintainers.filter((m) => m.chatId !== chatId))
    },
    [maintainers, persist],
  )

  const isMaintainer = useCallback(
    (chatId: string) => maintainers.some((m) => m.chatId === chatId),
    [maintainers],
  )

  return {
    maintainers,
    loading,
    error,
    reload,
    addMaintainer,
    removeMaintainer,
    isMaintainer,
  }
}
