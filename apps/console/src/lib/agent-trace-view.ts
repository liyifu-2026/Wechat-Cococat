import type { ConsoleEventDto } from "@/lib/console-events-client"

export type AgentTraceStep = {
  ts: string
  phase: string
  query?: string
  detail?: string
  confidence?: number
}

export type AgentTraceTurn = {
  turnId: string
  chatId?: string
  chatName?: string
  startedAt: string
  steps: AgentTraceStep[]
}

const TRACE_KIND = "agent_trace"

const KEY_PHASES = new Set([
  "inbound",
  "memory",
  "gather",
  "reflect",
  "thinking",
  "compose",
  "reply",
  "ack",
  "skip",
  "triage",
  "queue",
])

export function buildAgentTraceTurns(
  events: ConsoleEventDto[],
  maxTurns = 4,
): AgentTraceTurn[] {
  const traces = events.filter((e) => e.kind === TRACE_KIND && e.topic)
  const byTurn = new Map<string, AgentTraceTurn>()

  for (const ev of traces) {
    const turnId =
      ev.turnId ?? `${ev.chatId ?? "unknown"}:${ev.ts}:${ev.topic}`
    let turn = byTurn.get(turnId)
    if (!turn) {
      turn = {
        turnId,
        chatId: ev.chatId,
        chatName: ev.chatName,
        startedAt: ev.ts,
        steps: [],
      }
      byTurn.set(turnId, turn)
    }
    turn.steps.push({
      ts: ev.ts,
      phase: ev.topic!,
      query: ev.query,
      detail: ev.reason,
      confidence:
        typeof ev.confidence === "number" ? ev.confidence : undefined,
    })
    if (Date.parse(ev.ts) < Date.parse(turn.startedAt)) {
      turn.startedAt = ev.ts
    }
    if (!turn.chatName && ev.chatName) turn.chatName = ev.chatName
    if (!turn.chatId && ev.chatId) turn.chatId = ev.chatId
  }

  return [...byTurn.values()]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, maxTurns)
    .map((turn) => ({
      ...turn,
      steps: [...turn.steps].sort(
        (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
      ),
    }))
}

/** 合并 tool_in/tool_out，紧凑模式隐藏次要步骤。 */
export function compactTraceSteps(
  steps: AgentTraceStep[],
  verbose: boolean,
): AgentTraceStep[] {
  const merged: AgentTraceStep[] = []
  let pendingIn: AgentTraceStep | null = null

  for (const step of steps) {
    if (step.phase === "tool_in") {
      pendingIn = step
      continue
    }
    if (step.phase === "tool_out") {
      merged.push({
        ts: step.ts,
        phase: "tool",
        query: step.query ?? pendingIn?.query,
        detail: verbose
          ? [pendingIn?.detail, step.detail].filter(Boolean).join("\n---\n")
          : step.detail ?? pendingIn?.detail,
      })
      pendingIn = null
      continue
    }
    pendingIn = null
    if (!verbose && !KEY_PHASES.has(step.phase)) continue
    merged.push(step)
  }

  return merged
}

export function turnPreviewLine(turn: AgentTraceTurn, verbose: boolean): string {
  const steps = compactTraceSteps(turn.steps, verbose)
  const reply = [...steps].reverse().find((s) => s.phase === "reply")
  if (reply?.detail) {
    const oneLine = reply.detail.replace(/\s+/g, " ").trim()
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
  }
  const inbound = steps.find((s) => s.phase === "inbound")
  if (inbound?.detail) {
    const line = inbound.detail
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("【"))
    if (line) {
      const t = line.trim()
      return t.length > 72 ? `${t.slice(0, 72)}…` : t
    }
  }
  const last = steps[steps.length - 1]
  return last?.phase ?? "—"
}
