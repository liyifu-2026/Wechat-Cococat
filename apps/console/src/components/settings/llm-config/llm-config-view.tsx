import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LlmStackFile } from "@cococat/shared/llm-stack";
import {
  isProviderConfigured,
  listConfiguredProviders,
} from "@cococat/shared/llm-stack";
import { ModuleTabs } from "@/components/console/module-tabs";
import { Button } from "@/components/ui/button";
import { readConfigFile } from "@/lib/agent-config-client";
import { inferLlmStack, persistLlmStack } from "@/lib/llm-stack-persist";
import { multimodalConfigFromWikiIngestRole } from "@/lib/llm-stack-multimodal-sync";
import { useWikiStore, type ProviderConfigs } from "@/stores/wiki-store";
import { resolveConfig } from "../preset-resolver";
import { LLM_PRESETS } from "../llm-presets";
import { ProviderVaultTab } from "./provider-vault-tab";
import { StackAssignmentPanel } from "./stack-assignment-panel";

type LlmConfigTab = "providers" | "stack";

type LlmConfigViewProps = {
  embedded?: boolean;
};

type Baseline = {
  stack: string;
  configs: string;
};

function snapshot(stack: LlmStackFile, configs: ProviderConfigs): Baseline {
  return { stack: JSON.stringify(stack), configs: JSON.stringify(configs) };
}

export function LlmConfigView({ embedded = false }: LlmConfigViewProps) {
  const { t } = useTranslation();
  const setProviderConfigs = useWikiStore((s) => s.setProviderConfigs);
  const setActivePresetId = useWikiStore((s) => s.setActivePresetId);
  const llmConfig = useWikiStore((s) => s.llmConfig);
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig);
  const setMultimodalConfig = useWikiStore((s) => s.setMultimodalConfig);

  const [tab, setTab] = useState<LlmConfigTab>("providers");
  const [stack, setStack] = useState<LlmStackFile | null>(null);
  const [localConfigs, setLocalConfigs] = useState<ProviderConfigs>(() =>
    useWikiStore.getState().providerConfigs,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready">("loading");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [stackStatusMode, setStackStatusMode] = useState(false);
  const baselineRef = useRef<Baseline | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadState("loading");
      try {
        const agentEnv = await readConfigFile("agent.env").catch(() => "");
        const store = useWikiStore.getState();
        const inferred = await inferLlmStack(
          store.activePresetId,
          store.providerConfigs,
          agentEnv,
        );
        if (cancelled) return;
        const merged: LlmStackFile = {
          ...inferred,
          wikiIngestConcurrency:
            inferred.wikiIngestConcurrency ?? store.multimodalConfig.concurrency ?? 4,
        };
        setStack(merged);
        setLocalConfigs(store.providerConfigs);
        setMultimodalConfig(
          multimodalConfigFromWikiIngestRole(
            merged,
            store.providerConfigs,
            store.llmConfig,
            store.multimodalConfig,
          ),
        );
        baselineRef.current = snapshot(merged, store.providerConfigs);
        setStackStatusMode(true);
      } finally {
        if (!cancelled) setLoadState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setMultimodalConfig]);

  const dirty = useMemo(() => {
    if (!stack || !baselineRef.current) return false;
    const cur = snapshot(stack, localConfigs);
    return (
      cur.stack !== baselineRef.current.stack ||
      cur.configs !== baselineRef.current.configs
    );
  }, [stack, localConfigs]);

  async function handleSave() {
    if (!stack) return;

    const configured = listConfiguredProviders(localConfigs);
    if (configured.length === 0) {
      setStatusMsg(t("settings.sections.llmConfig.saveNeedsProvider"));
      setTab("providers");
      return;
    }
    if (!configured.includes(stack.roles.chat.providerId)) {
      setStatusMsg(t("settings.sections.llmConfig.saveNeedsChatProvider"));
      setTab("stack");
      setStackStatusMode(false);
      return;
    }
    if (!isProviderConfigured(stack.roles.chat.providerId, localConfigs)) {
      setStatusMsg(t("settings.sections.llmConfig.saveNeedsChatKey"));
      setTab("providers");
      return;
    }

    setSaving(true);
    setStatusMsg(null);
    try {
      const result = await persistLlmStack({
        stack,
        providerConfigs: localConfigs,
        llmConfig,
      });
      setProviderConfigs(localConfigs);
      setActivePresetId(stack.roles.chat.providerId);
      const preset = LLM_PRESETS.find((p) => p.id === stack.roles.chat.providerId);
      if (preset) {
        setLlmConfig(
          resolveConfig(
            preset,
            { ...localConfigs[stack.roles.chat.providerId], model: stack.roles.chat.model },
            llmConfig,
          ),
        );
      }
      setMultimodalConfig(result.multimodalConfig);
      baselineRef.current = snapshot(stack, localConfigs);
      const parts = result.needsRestart.map((x) =>
        x === "agent"
          ? t("settings.sections.llmConfig.restartAgent")
          : t("settings.sections.llmConfig.restartMemory"),
      );
      setStatusMsg(t("settings.sections.llmConfig.savedRestart", { targets: parts.join("、") }));
      setTab("stack");
      setStackStatusMode(true);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadState === "loading" || !stack) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.sections.llmConfig.loading")}
      </div>
    );
  }

  const tabs = [
    { id: "providers" as const, label: t("settings.sections.llmConfig.tabProviders") },
    { id: "stack" as const, label: t("settings.sections.llmConfig.tabStack") },
  ];

  return (
    <div className="space-y-4">
      {!embedded && (
        <h2 className="text-xl font-semibold">{t("settings.sections.llmConfig.title")}</h2>
      )}

      {dirty && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {t("settings.sections.llmConfig.unsavedChanges")}
        </p>
      )}

      <ModuleTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="LLM config" />

      <div className="pt-2">
        <div className={tab === "providers" ? undefined : "hidden"}>
          <ProviderVaultTab
            stack={stack}
            providerConfigs={localConfigs}
            onChangeConfigs={setLocalConfigs}
          />
        </div>
        <div className={tab === "stack" ? undefined : "hidden"}>
          <StackAssignmentPanel
            stack={stack}
            providerConfigs={localConfigs}
            dirty={dirty}
            onChangeStack={setStack}
            onGoProviders={() => setTab("providers")}
            forceStatusView={stackStatusMode && !dirty}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {dirty
            ? t("settings.sections.llmConfig.saveAll")
            : t("settings.sections.llmConfig.savedUpToDate")}
        </Button>
      </div>

      {statusMsg && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
          {statusMsg}
        </p>
      )}
    </div>
  );
}
