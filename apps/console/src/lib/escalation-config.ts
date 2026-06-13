export type EscalationWikiLink = {
  path: string
  note: string
}

export type EscalationConfigFile = {
  maintainer: { chatId: string; displayName: string }
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
  notifyOn: { escalate: true, probeLoop: true, lowConfidence: false },
  triage: { useLlm: false },
  lowConfidenceThreshold: 0.45,
  deflectLine: "您好，这边是 CocoCat 客服，请问有什么可以帮您？",
  customerLine: "好的，我们已收到您的诉求，同事会尽快通过微信与您联系，请稍候。",
  muteHours: { escalate: 24, probeLoop: 2 },
  probeStreakThreshold: 2,
  wikiLinks: [],
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
  const parsed = JSON.parse(raw) as Partial<EscalationConfigFile>
  return {
    maintainer: {
      chatId: parsed.maintainer?.chatId?.trim() ?? "",
      displayName: parsed.maintainer?.displayName?.trim() ?? "",
    },
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
