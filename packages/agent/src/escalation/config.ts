import { existsSync, readFileSync } from "node:fs";
import { configPath } from "../paths.js";
import type { EscalationConfig } from "./types.js";

const DEFAULT_CONFIG: EscalationConfig = {
  enabled: false,
  maintainerChatId: "",
  maintainerDisplayName: "",
  notifyEscalate: true,
  notifyProbeLoop: true,
  notifyLowConfidence: false,
  triageUseLlm: false,
  lowConfidenceThreshold: 0.45,
  deflectLine: "您好，这边是 CocoCat 客服，请问有什么可以帮您？",
  customerLine: "好的，我们已收到您的诉求，同事会尽快通过微信与您联系，请稍候。",
  muteHoursEscalate: 24,
  muteHoursProbeLoop: 2,
  probeStreakThreshold: 2,
};

export function loadEscalationConfig(): EscalationConfig {
  const path = configPath("escalation.json");
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const maintainer = (raw.maintainer ?? {}) as Record<string, unknown>;
    const notifyOn = (raw.notifyOn ?? {}) as Record<string, unknown>;
    const muteHours = (raw.muteHours ?? {}) as Record<string, unknown>;
    const triage = (raw.triage ?? {}) as Record<string, unknown>;

    const chatId =
      typeof maintainer.chatId === "string" ? maintainer.chatId.trim() : "";
    const displayName =
      typeof maintainer.displayName === "string"
        ? maintainer.displayName.trim()
        : "";

    return {
      enabled: Boolean(chatId || displayName),
      maintainerChatId: chatId,
      maintainerDisplayName: displayName,
      notifyEscalate: notifyOn.escalate !== false,
      notifyProbeLoop: notifyOn.probeLoop !== false,
      notifyLowConfidence: notifyOn.lowConfidence === true,
      triageUseLlm: triage.useLlm === true,
      lowConfidenceThreshold:
        typeof raw.lowConfidenceThreshold === "number" &&
        raw.lowConfidenceThreshold > 0 &&
        raw.lowConfidenceThreshold <= 1
          ? raw.lowConfidenceThreshold
          : DEFAULT_CONFIG.lowConfidenceThreshold,
      deflectLine:
        typeof raw.deflectLine === "string" && raw.deflectLine.trim()
          ? raw.deflectLine.trim()
          : DEFAULT_CONFIG.deflectLine,
      customerLine:
        typeof raw.customerLine === "string" && raw.customerLine.trim()
          ? raw.customerLine.trim()
          : DEFAULT_CONFIG.customerLine,
      muteHoursEscalate:
        typeof muteHours.escalate === "number" && muteHours.escalate > 0
          ? muteHours.escalate
          : DEFAULT_CONFIG.muteHoursEscalate,
      muteHoursProbeLoop:
        typeof muteHours.probeLoop === "number" && muteHours.probeLoop > 0
          ? muteHours.probeLoop
          : DEFAULT_CONFIG.muteHoursProbeLoop,
      probeStreakThreshold:
        typeof raw.probeStreakThreshold === "number" &&
        raw.probeStreakThreshold >= 1
          ? raw.probeStreakThreshold
          : DEFAULT_CONFIG.probeStreakThreshold,
    };
  } catch (err) {
    console.warn("[pi-wechat] failed to parse escalation.json:", err);
    return { ...DEFAULT_CONFIG };
  }
}
