import { invoke } from "@tauri-apps/api/core"

export type PreviewReplyResult = {
  action: string
  reason: string
  answer: string
  stealthOk: boolean
  bannedHits: string[]
  confidence?: number
  source?: "rules" | "llm"
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
