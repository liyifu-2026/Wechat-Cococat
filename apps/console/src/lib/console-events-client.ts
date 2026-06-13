import { invoke } from "@tauri-apps/api/core"

export type ConsoleEventDto = {
  ts: string
  kind: string
  chatId?: string
  chatName?: string
  turnId?: string
  topic?: string
  query?: string
  confidence?: number
  reason?: string
}

export function listConsoleEvents(
  maxLines = 120,
): Promise<ConsoleEventDto[]> {
  return invoke<ConsoleEventDto[]>("list_console_events", { maxLines })
}

export function readChatWikiHits(chatId: string): Promise<string[]> {
  return invoke<string[]>("read_chat_wiki_hits", { chatId })
}
