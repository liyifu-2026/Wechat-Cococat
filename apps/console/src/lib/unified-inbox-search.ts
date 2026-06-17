import {
  fetchDriverChatsFind,
  fetchDriverMessages,
  type DriverChat,
  type DriverMessage,
} from "@/lib/driver-client"
import { chatDisplayName } from "@/lib/wechat-ui"
import { messageDisplayBody } from "@/lib/wechat-message-body"

export type CrossChatMessageHit = {
  chat: DriverChat
  message: DriverMessage
  snippet: string
}

export function matchesChatQuery(chat: DriverChat, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [
    chatDisplayName(chat),
    chat.id,
    chat.name ?? "",
    chat.remark ?? "",
    chat.username ?? "",
    chat.lastMessagePreview ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return hay.includes(q)
}

/** Shared chat search: Driver find API when query ≥2 chars, else client filter. */
export async function resolveChatSearch(
  query: string,
  cachedChats: DriverChat[],
  limit = 50,
): Promise<DriverChat[]> {
  const q = query.trim()
  if (!q) return cachedChats.slice(0, limit)

  if (q.length >= 2) {
    try {
      const found = await fetchDriverChatsFind(q)
      if (found.length > 0) return found.slice(0, limit)
    } catch {
      // fall through to local filter
    }
  }

  return cachedChats.filter((c) => matchesChatQuery(c, q)).slice(0, limit)
}

export function filterMessagesByQuery<T extends { content?: string }>(
  messages: T[],
  query: string,
  body: (m: T) => string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return messages
  return messages.filter((m) => body(m).toLowerCase().includes(q))
}

function messageSnippet(content: string, query: string, max = 72): string {
  const q = query.trim().toLowerCase()
  const lower = content.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx < 0) return content.slice(0, max)
  const start = Math.max(0, idx - 16)
  const slice = content.slice(start, start + max)
  return start > 0 ? `…${slice}` : slice
}

export type MessageSearchProgress = {
  scannedChats: number
  totalChats: number
}

/** Search message bodies across all cached chats (paginated client scan). */
export async function searchMessagesAcrossChats(
  query: string,
  cachedChats: DriverChat[],
  opts?: {
    chatLimit?: number
    batchSize?: number
    maxPagesPerChat?: number
    hitLimit?: number
    onProgress?: (progress: MessageSearchProgress) => void
  },
): Promise<CrossChatMessageHit[]> {
  const q = query.trim()
  if (q.length < 1) return []

  const batchSize = opts?.batchSize ?? 100
  const maxPagesPerChat = opts?.maxPagesPerChat ?? 20
  const hitLimit = opts?.hitLimit ?? 24
  const qLower = q.toLowerCase()

  const nameMatches = await resolveChatSearch(q, cachedChats, cachedChats.length)
  const nameMatchIds = new Set(nameMatches.map((c) => c.id))
  const chats = [
    ...nameMatches,
    ...cachedChats.filter((c) => !nameMatchIds.has(c.id)),
  ].slice(0, opts?.chatLimit ?? cachedChats.length)

  const hits: CrossChatMessageHit[] = []
  let scannedChats = 0

  for (const chat of chats) {
    if (hits.length >= hitLimit) break
    scannedChats += 1
    opts?.onProgress?.({ scannedChats, totalChats: chats.length })

    let offset = 0
    try {
      for (let page = 0; page < maxPagesPerChat; page++) {
        if (hits.length >= hitLimit) break
        const messages = await fetchDriverMessages(chat.id, batchSize, offset)
        if (messages.length === 0) break
        offset += messages.length

        for (const message of messages) {
          const body = messageDisplayBody(message, () => "")
          if (!body || !body.toLowerCase().includes(qLower)) continue
          hits.push({
            chat,
            message,
            snippet: messageSnippet(body, q),
          })
          if (hits.length >= hitLimit) break
        }

        if (messages.length < batchSize) break
      }
    } catch {
      // ignore per-chat failures
    }
  }

  return hits.slice(0, hitLimit)
}
