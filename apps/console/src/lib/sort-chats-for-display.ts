import type { DriverChat } from "@/lib/driver-types"
import type { MaintainerInfo } from "@/lib/escalation-config"

export type ChatLayoutPreferences = {
  pinnedAt: Record<string, number>
}

export function chatLastActivityMs(chat: DriverChat): number {
  const raw = chat.lastActivityAt?.trim()
  if (!raw) return 0
  const t = Date.parse(raw)
  return Number.isNaN(t) ? 0 : t
}

function maintainerOrderIndex(
  chatId: string,
  maintainers: MaintainerInfo[],
): number {
  const idx = maintainers.findIndex((m) => m.chatId === chatId)
  return idx >= 0 ? idx : 9999
}

/**
 * W0 maintainer → W1 user pin → W2 normal; stable within tier.
 */
export function sortChatsForDisplay(
  chats: DriverChat[],
  maintainers: MaintainerInfo[],
  preferences: ChatLayoutPreferences,
): DriverChat[] {
  const maintainerIds = new Set(
    maintainers.map((m) => m.chatId).filter(Boolean),
  )
  const pinnedAt = preferences.pinnedAt ?? {}

  function tier(chat: DriverChat): number {
    if (maintainerIds.has(chat.id)) return 0
    if ((pinnedAt[chat.id] ?? 0) > 0) return 1
    return 2
  }

  return [...chats].sort((a, b) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb

    if (ta === 0) {
      const oa = maintainerOrderIndex(a.id, maintainers)
      const ob = maintainerOrderIndex(b.id, maintainers)
      if (oa !== ob) return oa - ob
      return chatLastActivityMs(b) - chatLastActivityMs(a)
    }

    if (ta === 1) {
      return (pinnedAt[b.id] ?? 0) - (pinnedAt[a.id] ?? 0)
    }

    return chatLastActivityMs(b) - chatLastActivityMs(a)
  })
}

export function partitionChatsForDisplay(
  chats: DriverChat[],
  maintainerIds: Set<string>,
  pinnedAt: Record<string, number>,
): { pinnedSection: DriverChat[]; normalSection: DriverChat[] } {
  const pinnedSection: DriverChat[] = []
  const normalSection: DriverChat[] = []
  for (const chat of chats) {
    if (maintainerIds.has(chat.id) || (pinnedAt[chat.id] ?? 0) > 0) {
      pinnedSection.push(chat)
    } else {
      normalSection.push(chat)
    }
  }
  return { pinnedSection, normalSection }
}
