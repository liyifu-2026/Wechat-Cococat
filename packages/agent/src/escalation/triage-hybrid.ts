import type { Message } from "@cococat/shared";
import type { TranscriptEntry } from "../transcript.js";
import type { EscalationConfig } from "./types.js";
import type { ChatEscalationState, TriageResult } from "./types.js";
import { loadTriageLlmConfig, triageWithLlm, type LlmTriageOutcome } from "./triage-llm.js";
import { triageCustomerText } from "./triage.js";

export type HybridTriageOutcome = TriageResult & {
  confidence: number;
  source: "rules" | "llm";
};

export type HybridTriageParams = {
  combinedText: string;
  chatState: ChatEscalationState;
  config: EscalationConfig;
  messages?: Message[];
  transcriptEntries?: TranscriptEntry[];
};

function rulesOutcome(
  result: TriageResult,
  confidence = 1,
): HybridTriageOutcome {
  return { ...result, confidence, source: "rules" };
}

/** 规则未决或 reply 默认 → 小模型（含 transcript）二次判决。 */
function needsLlmPass(ruleResult: TriageResult): boolean {
  if (ruleResult.action === "silent") return false;
  if (ruleResult.action !== "reply") return false;
  if (ruleResult.reason === "business_resumed") return false;
  return true;
}

export function isUnifiedGateLlmEnabled(config: EscalationConfig): boolean {
  const env = process.env.WECHAT_UNIFIED_GATE_LLM?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no") return false;
  if (env === "1" || env === "true" || env === "yes") return true;
  if (config.triageUseLlm) return true;
  return true;
}

export async function triageCustomerHybrid(
  params: HybridTriageParams,
): Promise<HybridTriageOutcome> {
  const {
    combinedText,
    chatState,
    config,
    messages,
    transcriptEntries = [],
  } = params;

  const ruleResult = triageCustomerText(
    combinedText,
    chatState,
    config,
    messages,
  );
  if (!needsLlmPass(ruleResult)) {
    return rulesOutcome(ruleResult);
  }

  if (!isUnifiedGateLlmEnabled(config)) {
    return rulesOutcome(ruleResult, 0.65);
  }

  const llmConfig = loadTriageLlmConfig();
  if (!llmConfig) {
    return rulesOutcome(ruleResult, 0.65);
  }

  try {
    const llm = await triageWithLlm(
      llmConfig,
      combinedText,
      chatState,
      transcriptEntries,
    );
    if (llm) return llm;
  } catch (err) {
    console.warn("[pi-wechat] unified gate LLM failed, using rules:", err);
  }

  return rulesOutcome(ruleResult, 0.65);
}
