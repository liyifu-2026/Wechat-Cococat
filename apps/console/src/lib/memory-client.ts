import { MEMORY_BASE_URL } from "@/lib/cococat-endpoints"
import { getHttpFetch } from "@/lib/tauri-fetch"

export type MemoryHealth = {
  status?: string
  version?: string
  uptime?: number
}

export type ConversationSearchResult = {
  results?: string
  total?: number
}

export type RecallResult = {
  context?: string
  strategy?: string
  memory_count?: number
}

async function memoryPost<T>(path: string, body: unknown): Promise<T> {
  const httpFetch = await getHttpFetch()
  const res = await httpFetch(`${MEMORY_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  return JSON.parse(text) as T
}

export async function fetchMemoryHealth(): Promise<MemoryHealth | null> {
  try {
    const httpFetch = await getHttpFetch()
    const res = await httpFetch(`${MEMORY_BASE_URL}/health`)
    if (!res.ok) return null
    return (await res.json()) as MemoryHealth
  } catch {
    return null
  }
}

export async function runRecall(
  sessionKey: string,
  query: string,
): Promise<RecallResult> {
  return memoryPost<RecallResult>("/recall", {
    session_key: sessionKey.trim(),
    query: query.trim(),
  })
}

export async function searchConversations(
  sessionKey: string,
  query = "最近对话",
  limit = 12,
): Promise<ConversationSearchResult> {
  return memoryPost<ConversationSearchResult>("/search/conversations", {
    session_key: sessionKey.trim(),
    query,
    limit,
  })
}

export async function searchMemories(
  query: string,
  limit = 10,
): Promise<{ results?: string; total?: number }> {
  return memoryPost("/search/memories", { query, limit })
}
