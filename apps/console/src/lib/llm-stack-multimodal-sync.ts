import {
  modelSupportsRole,
  resolveModelCapabilities,
} from "@cococat/shared/model-capabilities";
import {
  resolveRole,
  type LlmStackFile,
  type ProviderConfigs,
  type RoleBinding,
} from "@cococat/shared/llm-stack";
import { LLM_PRESETS } from "@/components/settings/llm-presets";
import { resolveConfig } from "@/components/settings/preset-resolver";
import type { LlmConfig, MultimodalConfig } from "@/stores/wiki-store";

function isInheritBinding(
  binding: RoleBinding,
): binding is Extract<RoleBinding, { mode: "inherit" }> {
  return binding.mode === "inherit";
}

function wikiIngestEnabled(binding: RoleBinding): boolean {
  return binding.enabled !== false;
}

function clampConcurrency(n: number): number {
  return Math.max(1, Math.min(16, Number.isFinite(n) ? n : 4));
}

/**
 * Project `multimodalConfig` is the runtime shape ingest reads.
 * Canonical source: llm-stack `wikiIngestCaption` (Console → 模型 → 用途分配).
 */
export function multimodalConfigFromWikiIngestRole(
  stack: LlmStackFile,
  providerConfigs: ProviderConfigs,
  llmConfig: LlmConfig,
  prev?: MultimodalConfig | null,
): MultimodalConfig {
  const binding = stack.roles.wikiIngestCaption;
  const resolved = resolveRole(stack, "wikiIngestCaption");
  const enabled =
    wikiIngestEnabled(binding) &&
    modelSupportsRole(resolveModelCapabilities(resolved.model), "wikiIngestCaption");
  const concurrency = clampConcurrency(
    stack.wikiIngestConcurrency ?? prev?.concurrency ?? 4,
  );

  if (isInheritBinding(binding)) {
    const overrideModel = binding.modelOverride?.trim();
    if (overrideModel) {
      const chatPreset = LLM_PRESETS.find(
        (p) => p.id === stack.roles.chat.providerId,
      );
      if (chatPreset) {
        const cfg = resolveConfig(
          chatPreset,
          {
            ...(providerConfigs[stack.roles.chat.providerId] ?? {}),
            model: overrideModel,
          },
          llmConfig,
        );
        return {
          enabled,
          useMainLlm: false,
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          model: cfg.model,
          ollamaUrl: cfg.ollamaUrl,
          customEndpoint: cfg.customEndpoint,
          azureApiVersion: cfg.azureApiVersion,
          azureModelFamily: cfg.azureModelFamily,
          apiMode: cfg.apiMode,
          concurrency,
        };
      }
    }

    return {
      enabled,
      useMainLlm: true,
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ollamaUrl: llmConfig.ollamaUrl,
      customEndpoint: llmConfig.customEndpoint,
      azureApiVersion: llmConfig.azureApiVersion,
      azureModelFamily: llmConfig.azureModelFamily,
      apiMode: llmConfig.apiMode,
      concurrency,
    };
  }

  const preset = LLM_PRESETS.find((p) => p.id === binding.providerId);
  if (!preset) {
    return {
      enabled,
      useMainLlm: true,
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ollamaUrl: llmConfig.ollamaUrl,
      customEndpoint: llmConfig.customEndpoint,
      azureApiVersion: llmConfig.azureApiVersion,
      azureModelFamily: llmConfig.azureModelFamily,
      apiMode: llmConfig.apiMode,
      concurrency,
    };
  }

  const cfg = resolveConfig(
    preset,
    {
      ...(providerConfigs[resolved.providerId] ?? {}),
      model: resolved.model,
    },
    llmConfig,
  );

  return {
    enabled,
    useMainLlm: false,
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model,
    ollamaUrl: cfg.ollamaUrl,
    customEndpoint: cfg.customEndpoint,
    azureApiVersion: cfg.azureApiVersion,
    azureModelFamily: cfg.azureModelFamily,
    apiMode: cfg.apiMode,
    concurrency,
  };
}
