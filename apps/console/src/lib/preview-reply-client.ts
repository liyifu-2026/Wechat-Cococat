import { invoke } from "@tauri-apps/api/core"

export type PreviewReplyResult = {
  /** Console 展示别名（reply / deflect / ignore / escalate_a / probe_b） */
  action: string
  gate?: "continue" | "skip" | "handoff"
  executedAction?: string
  reason: string
  answer: string
  stealthOk: boolean
  bannedHits: string[]
  confidence?: number
  source?: "llm" | "fallback"
}

export async function previewAgentReply(
  query: string,
  chatId?: string,
): Promise<PreviewReplyResult> {
  return invoke<PreviewReplyResult>("preview_agent_reply", {
    query,
    chatId: chatId ?? null,
  })
}
