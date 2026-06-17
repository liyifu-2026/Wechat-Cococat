import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  resolveAllRoles,
  type LlmStackFile,
} from "@cococat/shared/llm-stack";
import { capabilityTags, resolveModelCapabilities } from "@cococat/shared/model-capabilities";
import { Button } from "@/components/ui/button";
import { readConfigFile } from "@/lib/agent-config-client";
import { getEnvVar, parseEnvFile } from "@/lib/agent-env";
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
  dirty?: boolean;
};

export function EffectiveStatusTab({ stack, dirty = false }: EffectiveStatusTabProps) {
  const { t } = useTranslation();
  const [agentPiModel, setAgentPiModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const raw = await readConfigFile("agent.env").catch(() => "");
        const lines = parseEnvFile(raw);
        setAgentPiModel(getEnvVar(lines, "PI_MODEL") ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, [stack]);

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
      const raw = await readConfigFile("agent.env").catch(() => "");
      setAgentPiModel(getEnvVar(parseEnvFile(raw), "PI_MODEL") ?? null);
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
