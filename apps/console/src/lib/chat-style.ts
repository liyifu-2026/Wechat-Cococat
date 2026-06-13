export type ReplyMode = "fast" | "thoughtful" | ""

export type ThoughtfulAckMode = "off" | "default" | "custom"

export type ChatStyleForm = {
  replyMode: ReplyMode
  replyCooldownMs: number
  maxSendsPerTurn: number
  thoughtfulAck: ThoughtfulAckMode
  thoughtfulAckCustom: string
  thoughtfulReflect: boolean
}

export const DEFAULT_CHAT_STYLE_FORM: ChatStyleForm = {
  replyMode: "",
  replyCooldownMs: 30_000,
  maxSendsPerTurn: 1,
  thoughtfulAck: "off",
  thoughtfulAckCustom: "",
  thoughtfulReflect: false,
}

export function parseChatStyle(raw: string): ChatStyleForm {
  if (!raw.trim()) return { ...DEFAULT_CHAT_STYLE_FORM }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    let thoughtfulAck: ThoughtfulAckMode = "off"
    let thoughtfulAckCustom = ""
    if (data.thoughtfulAck === true) {
      thoughtfulAck = "default"
    } else if (typeof data.thoughtfulAck === "string" && data.thoughtfulAck.trim()) {
      thoughtfulAck = "custom"
      thoughtfulAckCustom = data.thoughtfulAck
    }

    return {
      replyMode:
        data.replyMode === "fast" || data.replyMode === "thoughtful"
          ? data.replyMode
          : "",
      replyCooldownMs:
        typeof data.replyCooldownMs === "number"
          ? data.replyCooldownMs
          : DEFAULT_CHAT_STYLE_FORM.replyCooldownMs,
      maxSendsPerTurn:
        typeof data.maxSendsPerTurn === "number"
          ? Math.min(5, Math.max(1, data.maxSendsPerTurn))
          : DEFAULT_CHAT_STYLE_FORM.maxSendsPerTurn,
      thoughtfulAck,
      thoughtfulAckCustom,
      thoughtfulReflect: data.thoughtfulReflect === true,
    }
  } catch {
    return { ...DEFAULT_CHAT_STYLE_FORM }
  }
}

export function serializeChatStyle(form: ChatStyleForm, existingRaw: string): string {
  let base: Record<string, unknown> = {}
  if (existingRaw.trim()) {
    try {
      base = JSON.parse(existingRaw) as Record<string, unknown>
    } catch {
      base = {}
    }
  }

  const next: Record<string, unknown> = { ...base }

  if (form.replyMode === "fast" || form.replyMode === "thoughtful") {
    next.replyMode = form.replyMode
  } else {
    delete next.replyMode
  }

  next.replyCooldownMs = form.replyCooldownMs
  next.maxSendsPerTurn = form.maxSendsPerTurn

  if (form.thoughtfulAck === "default") {
    next.thoughtfulAck = true
  } else if (form.thoughtfulAck === "custom" && form.thoughtfulAckCustom.trim()) {
    next.thoughtfulAck = form.thoughtfulAckCustom.trim()
  } else {
    delete next.thoughtfulAck
  }

  if (form.thoughtfulReflect) {
    next.thoughtfulReflect = true
  } else {
    delete next.thoughtfulReflect
  }

  return JSON.stringify(next, null, 2) + "\n"
}
