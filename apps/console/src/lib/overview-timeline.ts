import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import type { ConsoleEventDto } from "@/lib/console-events-client"

export type OverviewTimelineEvent = {
  id: string
  timeLabel: string
  sortTs: number
  kind: "escalate" | "probe" | "auto_reply" | "kb_gap"
  chatId?: string
  name: string
  topic?: string
}

function formatTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function parseSortTs(iso: string): number {
  const n = Date.parse(iso)
  return Number.isNaN(n) ? 0 : n
}

function eventToTimeline(
  ev: ConsoleEventDto,
  chatNames: Record<string, string>,
): OverviewTimelineEvent | null {
  const chatId = ev.chatId
  const name =
    (chatId && chatNames[chatId]) ||
    ev.chatName ||
    ev.topic ||
    ev.query ||
    "—"
  const sortTs = parseSortTs(ev.ts)
  const timeLabel = formatTimeLabel(ev.ts)
  const id = `ev-${ev.ts}-${ev.kind}-${chatId ?? ev.topic ?? ev.query ?? ""}`

  switch (ev.kind) {
    case "escalate_a":
      return {
        id,
        timeLabel,
        sortTs,
        kind: "escalate",
        chatId,
        name,
        topic: ev.topic,
      }
    case "probe_b":
      return {
        id,
        timeLabel,
        sortTs,
        kind: "probe",
        chatId,
        name,
        topic: ev.topic,
      }
    case "auto_reply":
      return {
        id,
        timeLabel,
        sortTs,
        kind: "auto_reply",
        chatId,
        name,
        topic: ev.topic,
      }
    case "low_confidence":
    case "no_wiki_hit":
      return {
        id,
        timeLabel,
        sortTs,
        kind: "kb_gap",
        chatId,
        name: ev.topic || ev.query || name,
        topic: ev.topic || ev.query,
      }
    default:
      return null
  }
}

export function extractKbGapEvents(
  events: ConsoleEventDto[],
  chatNames: Record<string, string>,
  max = 6,
): OverviewTimelineEvent[] {
  const gaps: OverviewTimelineEvent[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!
    if (ev.kind !== "low_confidence" && ev.kind !== "no_wiki_hit") continue
    const mapped = eventToTimeline(ev, chatNames)
    if (mapped) gaps.push(mapped)
    if (gaps.length >= max) break
  }
  return gaps
}

export function buildOverviewTimeline(
  mutes: EscalationMuteEntry[],
  chatNames: Record<string, string>,
  consoleEvents: ConsoleEventDto[] = [],
): OverviewTimelineEvent[] {
  const seen = new Set<string>()
  const items: OverviewTimelineEvent[] = []

  for (const m of mutes) {
    const name = chatNames[m.chat_id] || m.chat_name || m.chat_id
    const isEscalate =
      m.reason === "escalate_a" || m.reason === "escalate"
    const sortTs = parseSortTs(m.triggered_at)
    const id = `mute-${m.chat_id}`
    seen.add(id)
    items.push({
      id,
      timeLabel: formatTimeLabel(m.triggered_at),
      sortTs,
      kind: isEscalate ? "escalate" : "probe",
      chatId: m.chat_id,
      name,
    })
  }

  for (let i = consoleEvents.length - 1; i >= 0; i--) {
    const mapped = eventToTimeline(consoleEvents[i]!, chatNames)
    if (!mapped || seen.has(mapped.id)) continue
    if (mapped.kind === "kb_gap") continue
    seen.add(mapped.id)
    items.push(mapped)
  }

  return items
    .sort((a, b) => b.sortTs - a.sortTs)
    .slice(0, 8)
}
