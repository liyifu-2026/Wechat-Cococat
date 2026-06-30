import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  resolveAllRoles,
  resolveRole,
  type LlmStackFile,
} from "@cococat/shared/llm-stack";
import { capabilityTags, resolveModelCapabilities } from "@cococat/shared/model-capabilities";
import { Button } from "@/components/ui/button";
import { readConfigFile, writeConfigFile } from "@/lib/agent-config-client";
import {
  applyAgentEnvVars,
  getEnvVar,
  parseEnvFile,
  type EnvLine,
} from "@/lib/agent-env";
import { loadMultimodalConfig, saveMultimodalConfig } from "@/lib/project-store";
import { useWikiStore, type LlmConfig, type ProviderConfigs } from "@/stores/wiki-store";
import { multimodalConfigFromWikiIngestRole } from "@/lib/llm-stack-multimodal-sync";
import { LLM_PRESETS } from "../llm-presets";
import { stackCommand } from "@/lib/stack-client";

const ROLE_LABEL: Record<string, string> = {
  chat: "settings.sections.llmConfig.roles.chat",
  caption: "settings.sections.llmConfig.roles.caption",
  triage: "settings.sections.llmConfig.roles.triage",
  memoryRefine: "settings.sections.llmConfig.roles.memoryRefine",
  wikiIngestCaption: "settings.sections.llmConfig.roles.wikiIngestCaption",
};

type EffectiveStatusTabProps = {
  stack: LlmStackFile;
  providerConfigs: ProviderConfigs;
  llmConfig: LlmConfig;
  dirty?: boolean;
};

type ConfigSource = "agent.env" | "caption.env" | "memory.env" | "multimodalConfig";

type ConfigRow = {
  key: string;
  value: string | boolean | number | null | undefined;
  sensitive?: boolean;
};

type ConfigSection = {
  source: ConfigSource;
  rows: ConfigRow[];
};

type ConfigSnapshot = {
  agent: ReturnType<typeof parseEnvFile>;
  caption: ReturnType<typeof parseEnvFile>;
  memory: ReturnType<typeof parseEnvFile>;
  multimodal: Record<string, unknown> | null;
};

const API_KEY_PATTERN = /(?:API_KEY|TOKEN|SECRET|PASSWORD)/i;

function isEnvVar(line: EnvLine): line is Extract<EnvLine, { kind: "var" }> {
  return line.kind === "var";
}

function envValue(snapshot: ConfigSnapshot, source: ConfigSource, key: string): string | undefined {
  if (source === "agent.env") return getEnvVar(snapshot.agent, key);
  if (source === "caption.env") return getEnvVar(snapshot.caption, key);
  if (source === "memory.env") return getEnvVar(snapshot.memory, key);
  return undefined;
}

function presentSensitiveEnvKeys(snapshot: ConfigSnapshot, source: ConfigSource): ConfigRow[] {
  const lines =
    source === "agent.env"
      ? snapshot.agent
      : source === "caption.env"
        ? snapshot.caption
        : source === "memory.env"
          ? snapshot.memory
          : [];
  const seen = new Set<string>();
  return lines
    .filter(isEnvVar)
    .filter((line) => API_KEY_PATTERN.test(line.key))
    .filter((line) => {
      if (seen.has(line.key)) return false;
      seen.add(line.key);
      return true;
    })
    .map((line) => ({ key: line.key, value: line.value, sensitive: true }));
}

function boolText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function maskValue(value: unknown, sensitive?: boolean): string {
  const raw = boolText(value).trim();
  if (!raw) return "";
  if (!sensitive) return raw;
  if (raw.length <= 8) return "********";
  return `${"*".repeat(Math.min(8, raw.length - 4))}${raw.slice(-4)}`;
}

function getMultimodalValue(snapshot: ConfigSnapshot, key: string): string | boolean | number | null {
  const value = snapshot.multimodal?.[key];
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildConfigSections(snapshot: ConfigSnapshot): ConfigSection[] {
  const sections: ConfigSection[] = [
    {
      source: "agent.env",
      rows: [
        { key: "COCOCAT_AGENT_PRESET_ID", value: envValue(snapshot, "agent.env", "COCOCAT_AGENT_PRESET_ID") },
        { key: "PI_PROVIDER", value: envValue(snapshot, "agent.env", "PI_PROVIDER") },
        { key: "PI_MODEL", value: envValue(snapshot, "agent.env", "PI_MODEL") },
        { key: "WECHAT_UNIFIED_GATE_LLM", value: envValue(snapshot, "agent.env", "WECHAT_UNIFIED_GATE_LLM") },
        { key: "WECHAT_TRIAGE_LLM_ENABLED", value: envValue(snapshot, "agent.env", "WECHAT_TRIAGE_LLM_ENABLED") },
        { key: "WECHAT_TRIAGE_MODEL", value: envValue(snapshot, "agent.env", "WECHAT_TRIAGE_MODEL") },
        { key: "WECHAT_TRIAGE_API_URL", value: envValue(snapshot, "agent.env", "WECHAT_TRIAGE_API_URL") },
        { key: "WECHAT_TRIAGE_API_KEY", value: envValue(snapshot, "agent.env", "WECHAT_TRIAGE_API_KEY"), sensitive: true },
        ...presentSensitiveEnvKeys(snapshot, "agent.env"),
      ],
    },
    {
      source: "caption.env",
      rows: [
        { key: "WECHAT_CAPTION_ENABLED", value: envValue(snapshot, "caption.env", "WECHAT_CAPTION_ENABLED") },
        { key: "WECHAT_CAPTION_MODEL", value: envValue(snapshot, "caption.env", "WECHAT_CAPTION_MODEL") },
        { key: "WECHAT_CAPTION_API_URL", value: envValue(snapshot, "caption.env", "WECHAT_CAPTION_API_URL") },
        { key: "WECHAT_CAPTION_API_KEY", value: envValue(snapshot, "caption.env", "WECHAT_CAPTION_API_KEY"), sensitive: true },
        ...presentSensitiveEnvKeys(snapshot, "caption.env"),
      ],
    },
    {
      source: "memory.env",
      rows: [
        { key: "TDAI_LLM_PROVIDER", value: envValue(snapshot, "memory.env", "TDAI_LLM_PROVIDER") },
        { key: "TDAI_LLM_MODEL", value: envValue(snapshot, "memory.env", "TDAI_LLM_MODEL") },
        { key: "TDAI_LLM_BASE_URL", value: envValue(snapshot, "memory.env", "TDAI_LLM_BASE_URL") },
        { key: "TDAI_LLM_API_KEY", value: envValue(snapshot, "memory.env", "TDAI_LLM_API_KEY"), sensitive: true },
        ...presentSensitiveEnvKeys(snapshot, "memory.env"),
      ],
    },
    {
      source: "multimodalConfig",
      rows: [
        { key: "enabled", value: getMultimodalValue(snapshot, "enabled") },
        { key: "useMainLlm", value: getMultimodalValue(snapshot, "useMainLlm") },
        { key: "provider", value: getMultimodalValue(snapshot, "provider") },
        { key: "model", value: getMultimodalValue(snapshot, "model") },
        { key: "customEndpoint", value: getMultimodalValue(snapshot, "customEndpoint") },
        { key: "ollamaUrl", value: getMultimodalValue(snapshot, "ollamaUrl") },
        { key: "apiMode", value: getMultimodalValue(snapshot, "apiMode") },
        { key: "concurrency", value: getMultimodalValue(snapshot, "concurrency") },
        { key: "apiKey", value: getMultimodalValue(snapshot, "apiKey"), sensitive: true },
      ],
    },
  ];

  return sections.map((section) => {
    const seen = new Set<string>();
    return {
      ...section,
      rows: section.rows.filter((row) => {
        if (seen.has(row.key)) return false;
        seen.add(row.key);
        return true;
      }),
    };
  });
}

export function EffectiveStatusTab({
  stack,
  providerConfigs,
  llmConfig,
  dirty = false,
}: EffectiveStatusTabProps) {
  const { t } = useTranslation();
  const [agentPiModel, setAgentPiModel] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reloadSnapshot() {
    setLoading(true);
    try {
      let [agentRaw, captionRaw, memoryRaw, diskMultimodal] = await Promise.all([
        readConfigFile("agent.env").catch(() => ""),
        readConfigFile("caption.env").catch(() => ""),
        readConfigFile("memory.env").catch(() => ""),
        loadMultimodalConfig().catch(() => null),
      ]);
      const triage = resolveRole(stack, "triage");
      const caption = resolveRole(stack, "caption");
      const agentPatch: Record<string, string> = {
        WECHAT_UNIFIED_GATE_LLM: stack.unifiedGateLlm === false ? "false" : "true",
        WECHAT_TRIAGE_LLM_ENABLED: triage.enabled === false ? "false" : "true",
      };
      const nextAgentRaw = applyAgentEnvVars(agentRaw, agentPatch);
      if (nextAgentRaw !== agentRaw) {
        await writeConfigFile("agent.env", nextAgentRaw);
        agentRaw = nextAgentRaw;
      }

      const captionPatch: Record<string, string> = {
        WECHAT_CAPTION_ENABLED: caption.enabled === false ? "false" : "true",
      };
      const nextCaptionRaw = applyAgentEnvVars(captionRaw, captionPatch);
      if (nextCaptionRaw !== captionRaw) {
        await writeConfigFile("caption.env", nextCaptionRaw);
        captionRaw = nextCaptionRaw;
      }

      const canonicalMultimodal = multimodalConfigFromWikiIngestRole(
        stack,
        providerConfigs,
        llmConfig,
        diskMultimodal,
      );
      if (!sameJson(diskMultimodal, canonicalMultimodal)) {
        await saveMultimodalConfig(canonicalMultimodal);
        useWikiStore.getState().setMultimodalConfig(canonicalMultimodal);
        diskMultimodal = canonicalMultimodal;
      }

      const agent = parseEnvFile(agentRaw);
      const next: ConfigSnapshot = {
        agent,
        caption: parseEnvFile(captionRaw),
        memory: parseEnvFile(memoryRaw),
        multimodal:
          (diskMultimodal as Record<string, unknown> | null) ??
          (useWikiStore.getState().multimodalConfig as unknown as Record<string, unknown>),
      };
      setSnapshot(next);
      setAgentPiModel(getEnvVar(agent, "PI_MODEL") ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadSnapshot();
  }, [stack, providerConfigs, llmConfig]);

  const roles = resolveAllRoles(stack);
  const chatModel = stack.roles.chat.model;
  const drift = !dirty && agentPiModel && agentPiModel !== chatModel;

  async function restartAgent() {
    setRestarting(true);
    setMsg(null);
    try {
      await stackCommand("agent", "stop").catch(() => "");
      const out = await stackCommand("agent", "start");
      setMsg(out.trim() || t("settings.sections.llmConfig.restartOk"));
      await reloadSnapshot();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.sections.llmConfig.loadingStatus")}
      </div>
    );
  }

  const configSections = snapshot ? buildConfigSections(snapshot) : [];

  return (
    <div className="space-y-4">
      {drift && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
          {t("settings.sections.llmConfig.driftWarning", {
            disk: chatModel,
            agent: agentPiModel,
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("settings.sections.llmConfig.colRole")}</th>
              <th className="px-3 py-2 font-medium">{t("settings.sections.llmConfig.colProvider")}</th>
              <th className="px-3 py-2 font-medium">{t("settings.sections.llmConfig.model")}</th>
              <th className="px-3 py-2 font-medium">{t("settings.sections.llmConfig.colCaps")}</th>
              <th className="px-3 py-2 font-medium">{t("settings.sections.llmConfig.colFile")}</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const preset = LLM_PRESETS.find((p) => p.id === r.providerId);
              const caps = resolveModelCapabilities(r.model);
              const file =
                r.role === "memoryRefine"
                  ? "memory.env"
                  : r.role === "wikiIngestCaption"
                      ? "multimodalConfig"
                      : r.role === "caption"
                      ? "caption.env"
                      : "agent.env";
              return (
                <tr key={r.role} className="border-b last:border-0">
                  <td className="px-3 py-2">{t(ROLE_LABEL[r.role] ?? r.role)}</td>
                  <td className="px-3 py-2">{preset?.label ?? r.providerId}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2 text-xs">{capabilityTags(caps).join(" · ")}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{file}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="rounded-md border bg-muted/10 text-xs">
        <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span className="font-medium">{t("settings.sections.llmConfig.configDetails")}</span>
          <span>{t("settings.sections.llmConfig.configDetailsFoldedHint")}</span>
        </summary>

        <section className="space-y-3 border-t p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.llmConfig.configDetailsHint")}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void reloadSnapshot()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.sections.llmConfig.refreshStatus")}
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {configSections.map((section) => (
              <div key={section.source} className="rounded-md border bg-background/70">
                <div className="border-b px-3 py-2 font-mono text-xs font-medium">
                  {section.source}
                </div>
                <dl className="divide-y">
                  {section.rows.map((row) => {
                    const value = maskValue(row.value, row.sensitive);
                    const missing = !value;
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[minmax(120px,0.9fr)_minmax(0,1.1fr)] gap-2 px-3 py-2 text-xs"
                      >
                        <dt className="break-all font-mono text-muted-foreground">{row.key}</dt>
                        <dd
                          className={
                            missing
                              ? "font-mono text-muted-foreground/70"
                              : "break-all font-mono"
                          }
                        >
                          {missing ? t("settings.sections.llmConfig.configUnset") : value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        </section>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={restarting} onClick={() => void restartAgent()}>
          {restarting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t("settings.sections.llmConfig.restartAgent")}
        </Button>
      </div>

      {msg && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
          {msg}
        </p>
      )}
    </div>
  );
}
