export type MaintainerInfo = {
  chatId: string
  displayName: string
}

export type EscalationWikiLink = {
  path: string
  note: string
}

export type EscalationConfigFile = {
  /** 首维护人镜像（写盘兼容） */
  maintainer: MaintainerInfo
  maintainers: MaintainerInfo[]
  notifyOn: {
    escalate: boolean
    probeLoop: boolean
    lowConfidence: boolean
  }
  triage: { useLlm: boolean }
  lowConfidenceThreshold: number
  deflectLine: string
  customerLine: string
  muteHours: { escalate: number; probeLoop: number }
  probeStreakThreshold: number
  wikiLinks?: EscalationWikiLink[]
}

export const DEFAULT_ESCALATION: EscalationConfigFile = {
  maintainer: { chatId: "", displayName: "" },
  maintainers: [],
  notifyOn: { escalate: true, probeLoop: true, lowConfidence: false },
  triage: { useLlm: true },
  lowConfidenceThreshold: 0.45,
  deflectLine: "您好，这边是 CocoCat 客服，请问有什么可以帮您？",
  customerLine: "好的，我们已收到您的诉求，同事会尽快通过微信与您联系，请稍候。",
  muteHours: { escalate: 24, probeLoop: 2 },
  probeStreakThreshold: 2,
  wikiLinks: [],
}

function parseMaintainerEntry(raw: unknown): MaintainerInfo | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const chatId = typeof o.chatId === "string" ? o.chatId.trim() : ""
  const displayName =
    typeof o.displayName === "string" ? o.displayName.trim() : ""
  if (!chatId && !displayName) return null
  return { chatId, displayName }
}

export function normalizeMaintainers(raw: unknown): MaintainerInfo[] {
  const list: MaintainerInfo[] = []
  if (raw && typeof raw === "object" && Array.isArray((raw as { maintainers?: unknown }).maintainers)) {
    for (const item of (raw as { maintainers: unknown[] }).maintainers) {
      const entry = parseMaintainerEntry(item)
      if (entry) list.push(entry)
    }
  }
  if (list.length === 0 && raw && typeof raw === "object") {
    const legacy = parseMaintainerEntry(
      (raw as { maintainer?: unknown }).maintainer,
    )
    if (legacy) list.push(legacy)
  }
  const seen = new Set<string>()
  return list.filter((m) => {
    if (!m.chatId) return true
    if (seen.has(m.chatId)) return false
    seen.add(m.chatId)
    return true
  })
}

function normalizeWikiLinks(raw: unknown): EscalationWikiLink[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item): item is EscalationWikiLink =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as EscalationWikiLink).path === "string" &&
        typeof (item as EscalationWikiLink).note === "string",
    )
    .map((item) => ({
      path: item.path.trim(),
      note: item.note.trim(),
    }))
    .filter((item) => item.path && item.note)
}

export function parseEscalationConfig(raw: string): EscalationConfigFile {
  if (!raw.trim()) return { ...DEFAULT_ESCALATION, wikiLinks: [] }
  const parsed = JSON.parse(raw) as Partial<EscalationConfigFile> & {
    maintainer?: MaintainerInfo
    maintainers?: MaintainerInfo[]
  }
  const maintainers = normalizeMaintainers(parsed)
  const first = maintainers[0] ?? { chatId: "", displayName: "" }
  return {
    maintainer: first,
    maintainers,
    notifyOn: {
      escalate: parsed.notifyOn?.escalate !== false,
      probeLoop: parsed.notifyOn?.probeLoop !== false,
      lowConfidence: parsed.notifyOn?.lowConfidence === true,
    },
    triage: { useLlm: parsed.triage?.useLlm === true },
    lowConfidenceThreshold:
      typeof parsed.lowConfidenceThreshold === "number"
        ? parsed.lowConfidenceThreshold
        : DEFAULT_ESCALATION.lowConfidenceThreshold,
    deflectLine: parsed.deflectLine?.trim() || DEFAULT_ESCALATION.deflectLine,
    customerLine:
      parsed.customerLine?.trim() || DEFAULT_ESCALATION.customerLine,
    muteHours: {
      escalate: parsed.muteHours?.escalate ?? 24,
      probeLoop: parsed.muteHours?.probeLoop ?? 2,
    },
    probeStreakThreshold: parsed.probeStreakThreshold ?? 2,
    wikiLinks: normalizeWikiLinks(parsed.wikiLinks),
  }
}

/** 写盘：maintainers 为主，maintainer 镜像首项 */
export function serializeEscalationConfig(
  config: EscalationConfigFile,
): EscalationConfigFile {
  const maintainers = config.maintainers.filter(
    (m) => m.chatId.trim() || m.displayName.trim(),
  )
  return {
    ...config,
    maintainers,
    maintainer: maintainers[0] ?? { chatId: "", displayName: "" },
  }
}
