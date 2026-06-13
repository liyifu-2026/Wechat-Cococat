import { invoke } from "@tauri-apps/api/core"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import type { DriverMessage } from "@/lib/driver-client"

export type ChatProfile = {
  tags: string[]
}

export type ChatEscalationState = {
  deflectSent: boolean
  probeStreak: number
}

export async function readChatProfile(chatId: string): Promise<ChatProfile> {
  return invoke<ChatProfile>("read_chat_profile", { chatId })
}

export async function writeChatProfile(
  chatId: string,
  tags: string[],
): Promise<void> {
  await invoke("write_chat_profile", { chatId, tags })
}

export async function readChatEscalationState(
  chatId: string,
): Promise<ChatEscalationState> {
  const raw = await invoke<{
    deflectSent?: boolean
    probeStreak?: number
  }>("read_chat_escalation_state", { chatId })
  return {
    deflectSent: Boolean(raw.deflectSent),
    probeStreak:
      typeof raw.probeStreak === "number" && raw.probeStreak >= 0
        ? raw.probeStreak
        : 0,
  }
}

export function autoTagsFromEscalation(
  mute: EscalationMuteEntry | null | undefined,
  state: ChatEscalationState,
): string[] {
  const tags: string[] = []
  if (mute) {
    if (mute.reason === "escalate_a" || mute.reason === "escalate") {
      tags.push("转人工", "投诉过")
    } else if (mute.reason === "probe_b" || mute.reason === "probe_loop") {
      tags.push("B 级", "爱试探")
    } else {
      tags.push("已静音")
    }
  } else if (state.deflectSent) {
    tags.push("曾试探")
  }
  return tags
}

export function formatTriageSummary(
  mute: EscalationMuteEntry | null | undefined,
  state: ChatEscalationState,
): string {
  if (mute) {
    const hours = Math.max(
      0,
      Math.ceil((mute.muted_until - Date.now()) / (60 * 60 * 1000)),
    )
    if (mute.reason === "escalate_a" || mute.reason === "escalate") {
      return `ESCALATE_A · 投诉/转真人 · mute ${hours}h`
    }
    if (mute.reason === "probe_b" || mute.reason === "probe_loop") {
      return `PROBE_B · DEFLECT 后连续试探 · mute ${hours}h`
    }
    return `MUTE · 约剩 ${hours}h`
  }
  if (state.deflectSent && state.probeStreak > 0) {
    return `DEFLECT 已发 · 试探连击 ${state.probeStreak}`
  }
  if (state.deflectSent) {
    return `DEFLECT 已发 · 当前无 mute`
  }
  return "REPLY · 无 mute"
}

export function lastMessageTimestamp(messages: DriverMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const ts = messages[i]?.timestamp?.trim()
    if (ts) return ts
  }
  return null
}
