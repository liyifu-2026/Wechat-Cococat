import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCococatConfigDir } from "@cococat/shared";
import type { EscalationConfig } from "./types.js";
import {
  maintainerIdentityFromList,
  parseMaintainersFromRaw,
} from "./maintainers.js";

const DEFAULT_CONFIG: EscalationConfig = {
  enabled: false,
  maintainerChatId: "",
  maintainerDisplayName: "",
  maintainers: [],
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
  agentHandoffEnabled: true,
};

let configCache: { hash: string; config: EscalationConfig } | undefined;

function hashEscalationFile(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function loadFromRaw(raw: string): EscalationConfig {
  const hash = hashEscalationFile(raw);
  if (configCache && configCache.hash === hash) {
    return configCache.config;
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const config = parseEscalationRaw(parsed);
  configCache = { hash, config };
  return config;
}

export function escalationConfigPath(): string {
  return join(getCococatConfigDir(), "escalation.json");
}

export function clearEscalationConfigCache(): void {
  configCache = undefined;
}

function parseEscalationRaw(raw: Record<string, unknown>): EscalationConfig {
  const maintainers = parseMaintainersFromRaw(raw);
  const first = maintainers[0];
  const notifyOn = (raw.notifyOn ?? {}) as Record<string, unknown>;
  const muteHours = (raw.muteHours ?? {}) as Record<string, unknown>;
  const triage = (raw.triage ?? {}) as Record<string, unknown>;

  return {
    enabled: maintainers.some((m) => m.chatId || m.displayName),
    maintainerChatId: first?.chatId ?? "",
    maintainerDisplayName: first?.displayName ?? "",
    maintainers,
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
    agentHandoffEnabled: raw.agentHandoffEnabled !== false,
  };
}

function readEscalationConfigFromDisk(): EscalationConfig {
  const path = escalationConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    return loadFromRaw(readFileSync(path, "utf8"));
  } catch (err) {
    console.warn("[pi-wechat] failed to parse escalation.json:", err);
    return { ...DEFAULT_CONFIG };
  }
}

/** 读盘并刷新缓存（preview 等单次调用路径）。 */
export function loadEscalationConfig(): EscalationConfig {
  const path = escalationConfigPath();
  if (!existsSync(path)) {
    configCache = undefined;
    return { ...DEFAULT_CONFIG };
  }

  return readEscalationConfigFromDisk();
}

/** Agent 运行时按文件内容懒加载；内容未变则复用缓存。 */
export function loadEscalationConfigCached(): EscalationConfig {
  const path = escalationConfigPath();
  if (!existsSync(path)) {
    configCache = undefined;
    return { ...DEFAULT_CONFIG };
  }

  try {
    return loadFromRaw(readFileSync(path, "utf8"));
  } catch {
    return loadEscalationConfig();
  }
}

export function maintainerIdentity(cfg: EscalationConfig): string {
  if (cfg.maintainers.length > 0) {
    return maintainerIdentityFromList(cfg.maintainers);
  }
  return `${cfg.maintainerChatId}|${cfg.maintainerDisplayName}`;
}
