import type { Message } from "@cococat/shared";
import type { TranscriptEntry } from "../transcript.js";
import type { ChatEscalationState, EscalationConfig, GateAction } from "./types.js";
import { loadTriageLlmConfig, triageWithLlm } from "./triage-llm.js";
import {
  executedActionToDisplayAction,
  normalizeGateOutcome,
  type ExecutedAction,
  type NormalizedGateOutcome,
} from "./triage-normalize.js";

export type GateTriageOutcome = NormalizedGateOutcome & {
  /** Console / 旧 API 展示别名 */
  action: string;
};

export type GateTriageParams = {
  combinedText: string;
  chatState: ChatEscalationState;
  config: EscalationConfig;
  messages?: Message[];
  transcriptEntries?: TranscriptEntry[];
};

function finalizeOutcome(
  raw: {
    gate: GateAction;
    reason: string;
    confidence: number;
    source: "llm" | "fallback";
  },
  chatState: ChatEscalationState,
  config: EscalationConfig,
): GateTriageOutcome {
  const normalized = normalizeGateOutcome(
    {
      gate: raw.gate,
      reason: raw.reason,
      confidence: raw.confidence,
      source: raw.source,
    },
    chatState,
    config,
  );
  return {
    ...normalized,
    action: executedActionToDisplayAction(normalized.executedAction),
  };
}

export function isUnifiedGateLlmEnabled(config: EscalationConfig): boolean {
  const env = process.env.WECHAT_UNIFIED_GATE_LLM?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no") return false;
  if (env === "1" || env === "true" || env === "yes") return true;
  return config.triageUseLlm;
}

/** 统一 Gate：3 档 LLM → 状态机 → ExecutedAction；无 LLM 时 fallback continue。 */
export async function triageCustomerGate(
  params: GateTriageParams,
): Promise<GateTriageOutcome> {
  const {
    combinedText,
    chatState,
    config,
    transcriptEntries = [],
  } = params;

  const text = combinedText.trim();
  if (!text) {
    return finalizeOutcome(
      { gate: "skip", reason: "empty", confidence: 1, source: "fallback" },
      chatState,
      config,
    );
  }

  if (!isUnifiedGateLlmEnabled(config)) {
    return finalizeOutcome(
      { gate: "continue", reason: "llm_disabled", confidence: 0.5, source: "fallback" },
      chatState,
      config,
    );
  }

  const llmConfig = loadTriageLlmConfig();
  if (!llmConfig) {
    return finalizeOutcome(
      {
        gate: "continue",
        reason: "llm_unconfigured",
        confidence: 0.5,
        source: "fallback",
      },
      chatState,
      config,
    );
  }

  try {
    const llm = await triageWithLlm(
      llmConfig,
      combinedText,
      chatState,
      transcriptEntries,
    );
    if (llm) {
      return finalizeOutcome(
        {
          gate: llm.gate,
          reason: llm.reason,
          confidence: llm.confidence,
          source: llm.source,
        },
        chatState,
        config,
      );
    }
  } catch (err) {
    console.warn("[pi-wechat] unified gate LLM failed, using fallback:", err);
  }

  return finalizeOutcome(
    { gate: "continue", reason: "llm_failed", confidence: 0, source: "fallback" },
    chatState,
    config,
  );
}

/** @deprecated use triageCustomerGate */
export const triageCustomerHybrid = triageCustomerGate;

/** @deprecated use GateTriageOutcome */
export type HybridTriageOutcome = GateTriageOutcome;

/** @deprecated use GateTriageParams */
export type HybridTriageParams = GateTriageParams;
