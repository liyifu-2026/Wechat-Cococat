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
  patchChatProfile,
  readChatEscalationState,
  readChatProfile,
  type ChatEscalationState,
} from "@/lib/inbox-profile"
import { useChatLastActivityMs } from "@/stores/inbox-last-activity-store"

export function useInboxSessionContext(
  chat: DriverChat | null,
  muteEntry: EscalationMuteEntry | null,
  messages: DriverMessage[],
) {
  const [agentTags, setAgentTags] = useState<string[]>([])
  const [userType, setUserType] = useState<string | null>(null)
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
  const [profileSaving, setProfileSaving] = useState(false)

  const chatId = chat?.id ?? null
  const indexedLastMs = useChatLastActivityMs(chatId)

  const reload = useCallback(async () => {
    if (!chatId) {
      setAgentTags([])
      setUserType(null)
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
      setAgentTags(profile.tags ?? [])
      setUserType(profile.userType?.trim() || null)
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

  const lastContact = useMemo(() => {
    const fromMessages = lastMessageTimestamp(messages)
    if (fromMessages) return fromMessages
    if (indexedLastMs != null) {
      return new Date(indexedLastMs).toISOString()
    }
    if (muteEntry?.triggered_at) return muteEntry.triggered_at
    return null
  }, [indexedLastMs, messages, muteEntry?.triggered_at])

  const setUserTypeValue = useCallback(
    async (next: string | null) => {
      if (!chatId) return
      setProfileSaving(true)
      try {
        const profile = await patchChatProfile(chatId, {
          userType: next?.trim() || null,
        })
        setUserType(profile.userType?.trim() || null)
        setAgentTags(profile.tags ?? [])
      } finally {
        setProfileSaving(false)
      }
    },
    [chatId],
  )

  const memoryState = useMemo<MemoryDisplayState>(
    () => resolveMemoryDisplayState(memoryGatewayUp, memoryLines),
    [memoryGatewayUp, memoryLines],
  )

  return {
    loading,
    agentTags,
    userType,
    autoTags,
    triageSummary,
    kbHits,
    memoryLines,
    memoryState,
    memoryGatewayUp,
    firstContact,
    lastContact,
    profileSaving,
    setUserType: setUserTypeValue,
    reload,
  }
}
