import { resolveModelCapabilities, suggestMultimodalModel } from "./model-capabilities.js";

export const LLM_STACK_VERSION = 1 as const;

export type LlmRoleId =
  | "chat"
  | "caption"
  | "triage"
  | "memoryRefine"
  | "wikiIngestCaption";

export type RoleBinding =
  | {
      mode: "inherit";
      inheritFrom?: LlmRoleId;
      modelOverride?: string;
      enabled?: boolean;
    }
  | {
      mode: "custom";
      providerId: string;
      model: string;
      enabled?: boolean;
    };

export type LlmStackFile = {
  version: typeof LLM_STACK_VERSION;
  roles: {
    chat: { providerId: string; model: string };
    caption: RoleBinding;
    triage: RoleBinding;
    memoryRefine: { providerId: string; model: string };
    wikiIngestCaption: RoleBinding;
  };
  unifiedGateLlm?: boolean;
  /** Parallel caption requests during Wiki ingest (default 4). */
  wikiIngestConcurrency?: number;
};

export type ProviderConfigEntry = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export type ProviderConfigs = Record<string, ProviderConfigEntry>;

export type ResolvedRole = {
  role: LlmRoleId;
  providerId: string;
  model: string;
  enabled: boolean;
};

export function defaultLlmStack(
  chatProviderId: string,
  chatModel: string,
  memoryProviderId = "deepseek",
  memoryModel = "deepseek-v4-flash",
): LlmStackFile {
  const caps = resolveModelCapabilities(chatModel);
  const captionOverride =
    !caps.vision || !caps.audio
      ? suggestMultimodalModel(chatModel)
      : undefined;
  const wikiIngestOverride = !caps.vision
    ? suggestMultimodalModel(chatModel)
    : undefined;

  return {
    version: LLM_STACK_VERSION,
    roles: {
      chat: { providerId: chatProviderId, model: chatModel },
      caption: {
        mode: "inherit",
        inheritFrom: "chat",
        modelOverride: captionOverride,
        enabled: true,
      },
      triage: { mode: "inherit", inheritFrom: "chat", enabled: true },
      memoryRefine: { providerId: memoryProviderId, model: memoryModel },
      wikiIngestCaption: {
        mode: "inherit",
        inheritFrom: "chat",
        modelOverride: wikiIngestOverride,
        enabled: true,
      },
    },
    unifiedGateLlm: true,
    wikiIngestConcurrency: 4,
  };
}

function bindingEnabled(binding: RoleBinding): boolean {
  return binding.enabled !== false;
}

export function resolveRole(
  stack: LlmStackFile,
  role: LlmRoleId,
): ResolvedRole {
  switch (role) {
    case "chat": {
      const { providerId, model } = stack.roles.chat;
      return { role, providerId, model, enabled: true };
    }
    case "memoryRefine": {
      const { providerId, model } = stack.roles.memoryRefine;
      return { role, providerId, model, enabled: true };
    }
    case "caption":
    case "triage":
    case "wikiIngestCaption": {
      const binding = stack.roles[role];
      if (binding.mode === "custom") {
        return {
          role,
          providerId: binding.providerId,
          model: binding.model,
          enabled: bindingEnabled(binding),
        };
      }
      const from = binding.inheritFrom ?? "chat";
      const base = resolveRole(stack, from);
      return {
        role,
        providerId: base.providerId,
        model: binding.modelOverride?.trim() || base.model,
        enabled: bindingEnabled(binding),
      };
    }
    default:
      return resolveRole(stack, "chat");
  }
}

export function resolveAllRoles(stack: LlmStackFile): ResolvedRole[] {
  const ids: LlmRoleId[] = [
    "chat",
    "caption",
    "triage",
    "memoryRefine",
    "wikiIngestCaption",
  ];
  return ids.map((role) => resolveRole(stack, role));
}

export function isProviderConfigured(
  providerId: string,
  configs: ProviderConfigs,
): boolean {
  const ov = configs[providerId];
  if (!ov) return false;
  const key = ov.apiKey?.trim();
  if (key) return true;
  // Ollama / local may work without key
  if (providerId.startsWith("ollama")) return Boolean(ov.baseUrl?.trim());
  return false;
}

export function listConfiguredProviders(
  configs: ProviderConfigs,
): string[] {
  return Object.keys(configs).filter((id) => isProviderConfigured(id, configs));
}

/** Provider ids present in the vault (configured or pending API key entry). */
export function listVaultProviderIds(configs: ProviderConfigs): string[] {
  return Object.keys(configs).filter((id) => id.trim().length > 0);
}

export function parseLlmStack(raw: unknown): LlmStackFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== LLM_STACK_VERSION) return null;
  const roles = o.roles;
  if (!roles || typeof roles !== "object") return null;
  const r = roles as Record<string, unknown>;
  const chat = r.chat as { providerId?: string; model?: string } | undefined;
  if (!chat?.providerId?.trim() || !chat?.model?.trim()) return null;
  return raw as LlmStackFile;
}
