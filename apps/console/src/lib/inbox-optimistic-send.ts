import type { DriverMessage } from "@/lib/driver-types"
import { messageTimestampMs } from "@/lib/inbox-message-time-divider"

export type OptimisticPending = {
  clientMsgId: string
  chatId: string
  text: string
  createdAt: number
}

export function createClientMsgId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Stable negative localId for pending rows (never collides with DB ids). */
export function optimisticLocalId(clientMsgId: string): number {
  let hash = 0
  for (let i = 0; i < clientMsgId.length; i++) {
    hash = (Math.imul(31, hash) + clientMsgId.charCodeAt(i)) | 0
  }
  if (hash === 0) return -1
  return hash > 0 ? -hash : hash
}

export function buildOptimisticMessage(pending: OptimisticPending): DriverMessage {
  return {
    localId: optimisticLocalId(pending.clientMsgId),
    chatId: pending.chatId,
    type: 1,
    content: pending.text,
    timestamp: new Date(pending.createdAt).toISOString(),
    isSelf: true,
    clientMsgId: pending.clientMsgId,
    pending: true,
  }
}

export function stripPendingMessages(messages: DriverMessage[]): DriverMessage[] {
  return messages.filter((m) => !m.pending)
}

export const SEND_RECONCILE_DELAYS_MS = [200, 600, 1500] as const

/** Drop unmatched optimistic rows after this age. */
export const MAX_PENDING_AGE_MS = 120_000

function normalizeContent(text: string): string {
  return text.trim()
}

function findContentMatch(
  pending: OptimisticPending,
  serverMessages: DriverMessage[],
  claimedLocalIds: Set<number>,
): DriverMessage | undefined {
  const target = normalizeContent(pending.text)
  if (!target) return undefined

  const candidates = serverMessages.filter(
    (m) =>
      m.isSelf &&
      m.localId != null &&
      !claimedLocalIds.has(m.localId) &&
      normalizeContent(m.content) === target,
  )
  if (candidates.length === 0) return undefined

  return candidates.reduce((best, m) => {
    const dt = Math.abs(messageTimestampMs(m) - pending.createdAt)
    const bestDt = Math.abs(messageTimestampMs(best) - pending.createdAt)
    return dt < bestDt ? m : best
  })
}

/**
 * Overlay unresolved optimistic sends onto server messages.
 * Primary reconcile key is clientMsgId; self/content match is a fallback.
 * Final order always follows server timestamps.
 */
export function applyOptimisticLayer(
  serverMessages: DriverMessage[],
  pendings: OptimisticPending[],
): { messages: DriverMessage[]; resolvedClientIds: string[] } {
  const now = Date.now()
  const resolvedClientIds: string[] = []
  const serverByClientId = new Map<string, DriverMessage>()
  for (const m of serverMessages) {
    if (m.clientMsgId) serverByClientId.set(m.clientMsgId, m)
  }

  const activePendings = pendings.filter(
    (p) => now - p.createdAt <= MAX_PENDING_AGE_MS,
  )
  for (const p of pendings) {
    if (now - p.createdAt > MAX_PENDING_AGE_MS) {
      resolvedClientIds.push(p.clientMsgId)
    }
  }

  const stillPending: OptimisticPending[] = []
  for (const p of activePendings) {
    if (serverByClientId.has(p.clientMsgId)) {
      resolvedClientIds.push(p.clientMsgId)
    } else {
      stillPending.push(p)
    }
  }

  const claimedLocalIds = new Set<number>()
  for (const m of serverMessages) {
    if (
      m.clientMsgId &&
      activePendings.some((p) => p.clientMsgId === m.clientMsgId) &&
      m.localId != null
    ) {
      claimedLocalIds.add(m.localId)
    }
  }

  const contentResolved: OptimisticPending[] = []
  for (const p of stillPending) {
    const match = findContentMatch(p, serverMessages, claimedLocalIds)
    if (match?.localId != null) {
      resolvedClientIds.push(p.clientMsgId)
      claimedLocalIds.add(match.localId)
    } else {
      contentResolved.push(p)
    }
  }

  const optimistic = contentResolved.map((p) => buildOptimisticMessage(p))
  const pendingIds = new Set(contentResolved.map((p) => p.clientMsgId))
  const serverRows = serverMessages.filter(
    (m) => !m.clientMsgId || !pendingIds.has(m.clientMsgId),
  )

  const merged = [...optimistic, ...serverRows].sort(
    (a, b) => messageTimestampMs(b) - messageTimestampMs(a),
  )
  return { messages: merged, resolvedClientIds }
}
