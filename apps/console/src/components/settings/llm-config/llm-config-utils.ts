import {
  listConfiguredProviders,
  type LlmStackFile,
  type ProviderConfigs,
} from "@cococat/shared/llm-stack";
import {
  modelSupportsRole,
  resolveModelCapabilities,
} from "@cococat/shared/model-capabilities";
import { LLM_PRESETS } from "../llm-presets";

export function isProviderUsedInStack(stack: LlmStackFile, providerId: string): boolean {
  if (stack.roles.chat.providerId === providerId) return true;
  if (stack.roles.memoryRefine.providerId === providerId) return true;
  for (const role of ["caption", "triage", "wikiIngestCaption"] as const) {
    const binding = stack.roles[role];
    if (binding.mode === "custom" && binding.providerId === providerId) return true;
  }
  return false;
}

export type ProviderSelectOption = {
  id: string;
  label: string;
  configured: boolean;
};

/** Only configured providers; keep current selections visible even if Key missing. */
export function providerSelectOptions(
  stack: LlmStackFile,
  providerConfigs: ProviderConfigs,
): ProviderSelectOption[] {
  const configured = new Set(listConfiguredProviders(providerConfigs));
  const keep = new Set<string>(configured);
  keep.add(stack.roles.chat.providerId);
  keep.add(stack.roles.memoryRefine.providerId);
  for (const role of ["caption", "triage", "wikiIngestCaption"] as const) {
    const binding = stack.roles[role];
    if (binding.mode === "custom") keep.add(binding.providerId);
  }

  return [...keep]
    .filter((id) => LLM_PRESETS.some((p) => p.id === id))
    .map((id) => {
      const preset = LLM_PRESETS.find((p) => p.id === id);
      const ok = configured.has(id);
      return {
        id,
        label: preset?.label ?? id,
        configured: ok,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function modelOptionsForProvider(
  providerId: string,
  _providerConfigs?: ProviderConfigs,
  opts?: {
    filterRole?: "caption" | "wikiIngestCaption" | "triage";
    currentModel?: string;
  },
): string[] {
  const preset = LLM_PRESETS.find((p) => p.id === providerId);
  const suggested = preset?.suggestedModels ?? [];
  const defaultModel = preset?.defaultModel ?? "";
  let all =
    defaultModel && !suggested.includes(defaultModel)
      ? [defaultModel, ...suggested]
      : suggested.length > 0
        ? suggested
        : defaultModel
          ? [defaultModel]
          : [];

  const current = opts?.currentModel?.trim();
  if (current && !all.includes(current)) {
    all = [current, ...all];
  }

  if (opts?.filterRole) {
    all = all.filter((m) =>
      modelSupportsRole(resolveModelCapabilities(m), opts.filterRole!),
    );
    if (current && !all.includes(current)) {
      all = [current, ...all];
    }
  }

  return all;
}
