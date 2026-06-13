import { useCallback, useEffect, useMemo, useState } from "react"
import {
  listAgentChats,
  readChatMemorySummary,
  type EscalationMuteEntry,
} from "@/lib/agent-config-client"
import { readChatWikiHits } from "@/lib/console-events-client"
import type { DriverChat, DriverMessage } from "@/lib/driver-client"
import { useStackHealth } from "@/hooks/use-stack-health"
import { fetchMemoryHealth } from "@/lib/memory-client"
import {
  isMemoryGatewayHealthy,
  resolveMemoryDisplayState,
  type MemoryDisplayState,
} from "@/lib/memory-display"
import {
  autoTagsFromEscalation,
  formatTriageSummary,
  lastMessageTimestamp,
  readChatEscalationState,
  readChatProfile,
  writeChatProfile,
  type ChatEscalationState,
} from "@/lib/inbox-profile"

export function useInboxSessionContext(
  chat: DriverChat | null,
  muteEntry: EscalationMuteEntry | null,
  messages: DriverMessage[],
) {
  const [manualTags, setManualTags] = useState<string[]>([])
  const [escalationState, setEscalationState] = useState<ChatEscalationState>({
    deflectSent: false,
    probeStreak: 0,
  })
  const [memoryLines, setMemoryLines] = useState<string[]>([])
  const [memoryGatewayUp, setMemoryGatewayUp] = useState(false)
  const stackHealth = useStackHealth()
  const [kbHits, setKbHits] = useState<string[]>([])
  const [firstContact, setFirstContact] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)

  const chatId = chat?.id ?? null

  const reload = useCallback(async () => {
    if (!chatId) {
      setManualTags([])
      setEscalationState({ deflectSent: false, probeStreak: 0 })
      setMemoryLines([])
      setMemoryGatewayUp(false)
      setKbHits([])
      setFirstContact(null)
      return
    }
    setLoading(true)
    try {
      const [profile, state, agentChats, hits, memory, gatewayHealth] =
        await Promise.all([
          readChatProfile(chatId),
          readChatEscalationState(chatId),
          listAgentChats().catch(() => []),
          readChatWikiHits(chatId).catch(() => []),
          readChatMemorySummary(chatId).catch(() => ({ lines: [] })),
          fetchMemoryHealth().catch(() => null),
        ])
      setKbHits(hits)
      setManualTags(profile.tags ?? [])
      setEscalationState(state)
      setMemoryLines(memory.lines ?? [])
      setMemoryGatewayUp(
        isMemoryGatewayHealthy(
          stackHealth.memory === "up",
          gatewayHealth?.status,
        ),
      )

      const summary = agentChats.find((c) => c.chat_id === chatId)
      setFirstContact(summary?.created_at ?? null)
    } finally {
      setLoading(false)
    }
  }, [chatId, stackHealth.memory])

  useEffect(() => {
    if (!chatId) return
    let cancelled = false
    void fetchMemoryHealth()
      .then((health) => {
        if (cancelled) return
        setMemoryGatewayUp(
          isMemoryGatewayHealthy(stackHealth.memory === "up", health?.status),
        )
      })
      .catch(() => {
        if (!cancelled) setMemoryGatewayUp(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId, stackHealth.memory])

  useEffect(() => {
    void reload()
  }, [reload])

  const autoTags = useMemo(
    () => autoTagsFromEscalation(muteEntry, escalationState),
    [muteEntry, escalationState],
  )

  const triageSummary = useMemo(
    () => formatTriageSummary(muteEntry, escalationState),
    [muteEntry, escalationState],
  )

  const lastContact = useMemo(
    () => lastMessageTimestamp(messages) ?? muteEntry?.triggered_at ?? null,
    [messages, muteEntry?.triggered_at],
  )

  const persistTags = useCallback(
    async (next: string[]) => {
      if (!chatId) return
      setTagSaving(true)
      try {
        await writeChatProfile(chatId, next)
        setManualTags(next)
      } finally {
        setTagSaving(false)
      }
    },
    [chatId],
  )

  const addTag = useCallback(
    async (raw: string) => {
      const tag = raw.trim()
      if (!tag || !chatId) return
      const merged = [...manualTags]
      if (merged.includes(tag) || autoTags.includes(tag)) return
      await persistTags([...merged, tag])
    },
    [autoTags, chatId, manualTags, persistTags],
  )

  const removeTag = useCallback(
    async (tag: string) => {
      if (!chatId) return
      await persistTags(manualTags.filter((t) => t !== tag))
    },
    [chatId, manualTags, persistTags],
  )

  const memoryState = useMemo<MemoryDisplayState>(
    () => resolveMemoryDisplayState(memoryGatewayUp, memoryLines),
    [memoryGatewayUp, memoryLines],
  )

  return {
    loading,
    manualTags,
    autoTags,
    triageSummary,
    kbHits,
    memoryLines,
    memoryState,
    memoryGatewayUp,
    firstContact,
    lastContact,
    tagSaving,
    addTag,
    removeTag,
    reload,
  }
}
