import { invoke } from "@tauri-apps/api/core"

export type AgentChatSummary = {
  chat_id: string
  dir_name: string
  created_at?: string
  last_local_id?: number
}

export type CococatPaths = {
  config_dir: string
  data_dir: string
}

export function readConfigFile(name: string): Promise<string> {
  return invoke<string>("read_config_file", { name })
}

export function writeConfigFile(name: string, content: string): Promise<void> {
  return invoke<void>("write_config_file", { name, content })
}

export function listAgentChats(): Promise<AgentChatSummary[]> {
  return invoke<AgentChatSummary[]>("list_agent_chats")
}

export function readAgentChatFile(
  dirName: string,
  file: string,
): Promise<string> {
  return invoke<string>("read_agent_chat_file", {
    dirName,
    file,
  })
}

export function writeAgentChatFile(
  dirName: string,
  file: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_agent_chat_file", {
    dirName,
    file,
    content,
  })
}

export function readMemoryPersona(chatId: string): Promise<string> {
  return invoke<string>("read_memory_persona", { chatId })
}

export function readStackLog(maxLines = 80): Promise<string> {
  return invoke<string>("read_stack_log", { maxLines })
}

export function detectLegacyConfig(): Promise<boolean> {
  return invoke<boolean>("detect_legacy_config")
}

export function getCococatPaths(): Promise<CococatPaths> {
  return invoke<CococatPaths>("get_cococat_paths")
}

export function openCococatFolder(kind: "config" | "data"): Promise<void> {
  return invoke<void>("open_cococat_folder", { kind })
}

export type EscalationMuteEntry = {
  chat_id: string
  chat_name: string
  reason: string
  muted_until: number
  triggered_at: string
}

export function listEscalationMutes(): Promise<EscalationMuteEntry[]> {
  return invoke<EscalationMuteEntry[]>("list_escalation_mutes")
}

export function unmuteEscalationChat(chatId: string): Promise<boolean> {
  return invoke<boolean>("unmute_escalation_chat", { chatId })
}

export type ChatMemorySummary = {
  lines: string[]
}

export function readChatMemorySummary(
  chatId: string,
  maxLines = 3,
): Promise<ChatMemorySummary> {
  return invoke<ChatMemorySummary>("read_chat_memory_summary", {
    chatId,
    maxLines,
  })
}
