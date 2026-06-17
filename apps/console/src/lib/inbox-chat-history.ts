import {
  fetchDriverMessages,
  type DriverMessage,
} from "@/lib/driver-client"

export type HistoryTab = "all" | "image" | "voice"

export const HISTORY_SCAN_BATCH = 100
export const HISTORY_MATCH_TARGET = 30

export function matchesHistoryTab(
  m: DriverMessage,
  tab: HistoryTab,
): boolean {
  if (tab === "all") return true
  if (tab === "image") {
    return m.mediaKind === "image" || m.mediaKind === "emoji"
  }
  if (tab === "voice") return m.mediaKind === "voice"
  return false
}

export type HistoryScanResult = {
  matches: DriverMessage[]
  nextOffset: number
  exhausted: boolean
}

/** Scan message pages (newest-first) until `target` tab matches or DB exhausted. */
export async function scanHistoryMessages(
  chatId: string,
  tab: HistoryTab,
  startOffset: number,
  target = HISTORY_MATCH_TARGET,
): Promise<HistoryScanResult> {
  const matches: DriverMessage[] = []
  let offset = startOffset
  let exhausted = false

  while (matches.length < target && !exhausted) {
    const batch = await fetchDriverMessages(chatId, HISTORY_SCAN_BATCH, offset)
    if (batch.length === 0) {
      exhausted = true
      break
    }
    offset += batch.length
    for (const m of batch) {
      if (matchesHistoryTab(m, tab)) matches.push(m)
    }
    if (batch.length < HISTORY_SCAN_BATCH) exhausted = true
  }

  return { matches, nextOffset: offset, exhausted }
}
