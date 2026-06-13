import {
  fetchDriverChatsFind,
  fetchDriverMessages,
  type DriverChat,
  type DriverMessage,
} from "@/lib/driver-client"
import { chatDisplayName } from "@/lib/wechat-ui"

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

/** Search message bodies across top matching chats (client-side, no Driver FTS). */
export async function searchMessagesAcrossChats(
  query: string,
  cachedChats: DriverChat[],
  opts?: { chatLimit?: number; perChatMessages?: number; hitLimit?: number },
): Promise<CrossChatMessageHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const chatLimit = opts?.chatLimit ?? 6
  const perChatMessages = opts?.perChatMessages ?? 50
  const hitLimit = opts?.hitLimit ?? 8

  const chats = await resolveChatSearch(q, cachedChats, chatLimit)
  const hits: CrossChatMessageHit[] = []
  const qLower = q.toLowerCase()

  await Promise.all(
    chats.map(async (chat) => {
      if (hits.length >= hitLimit) return
      try {
        const messages = await fetchDriverMessages(chat.id, perChatMessages)
        for (const message of messages) {
          const body = message.content?.trim() ?? ""
          if (!body || !body.toLowerCase().includes(qLower)) continue
          hits.push({
            chat,
            message,
            snippet: messageSnippet(body, q),
          })
          break
        }
      } catch {
        // ignore per-chat failures
      }
    }),
  )

  return hits.slice(0, hitLimit)
}
