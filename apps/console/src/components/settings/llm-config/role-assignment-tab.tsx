import { useTranslation } from "react-i18next";
import {
  listConfiguredProviders,
  resolveRole,
  type LlmStackFile,
  type LlmRoleId,
  type RoleBinding,
} from "@cococat/shared/llm-stack";
import {
  modelSupportsRole,
  resolveModelCapabilities,
  suggestMultimodalModel,
} from "@cococat/shared/model-capabilities";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/info-tip";
import type { ProviderConfigs } from "@/stores/wiki-store";
import { ModelCapabilityBadges } from "./model-capability-badges";
import {
  modelOptionsForProvider,
  providerSelectOptions,
} from "./llm-config-utils";

const ROLE_ROWS: Array<{
  role: LlmRoleId;
  labelKey: string;
  hintKey: string;
  filterRole?: "caption" | "wikiIngestCaption" | "triage";
}> = [
  {
    role: "chat",
    labelKey: "settings.sections.llmConfig.roles.chat",
    hintKey: "settings.sections.llmConfig.roles.chatHint",
  },
  {
    role: "caption",
    labelKey: "settings.sections.llmConfig.roles.caption",
    hintKey: "settings.sections.llmConfig.roles.captionHint",
    filterRole: "caption",
  },
  {
    role: "triage",
    labelKey: "settings.sections.llmConfig.roles.triage",
    hintKey: "settings.sections.llmConfig.roles.triageHint",
    filterRole: "triage",
  },
  {
    role: "memoryRefine",
    labelKey: "settings.sections.llmConfig.roles.memoryRefine",
    hintKey: "settings.sections.llmConfig.roles.memoryRefineHint",
  },
  {
    role: "wikiIngestCaption",
    labelKey: "settings.sections.llmConfig.roles.wikiIngestCaption",
    hintKey: "settings.sections.llmConfig.roles.wikiIngestHint",
    filterRole: "wikiIngestCaption",
  },
];

type RoleAssignmentTabProps = {
  stack: LlmStackFile;
  providerConfigs: ProviderConfigs;
  onChangeStack: (next: LlmStackFile) => void;
  onGoProviders?: () => void;
};


function ProviderSelect({
  value,
  options,
  disabled,
  onChange,
  pendingSuffix,
}: {
  value: string;
  options: ReturnType<typeof providerSelectOptions>;
  disabled?: boolean;
  onChange: (id: string) => void;
  pendingSuffix: string;
}) {
  return (
    <select
      className="wx-themed-select mt-1 w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2 py-1.5 text-sm text-[var(--wx-text)] disabled:opacity-50"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((p) => (
        <option key={p.id} value={p.id} disabled={!p.configured}>
          {p.label}
          {!p.configured ? ` (${pendingSuffix})` : ""}
        </option>
      ))}
    </select>
  );
}

export function RoleAssignmentTab({
  stack,
  providerConfigs,
  onChangeStack,
  onGoProviders,
}: RoleAssignmentTabProps) {
  const { t } = useTranslation();
  const configured = listConfiguredProviders(providerConfigs);
  const providerOptions = providerSelectOptions(stack, providerConfigs);
  const rolesDisabled = configured.length === 0;
  const pendingSuffix = t("settings.sections.llmConfig.pendingBadge");

  function setChat(providerId: string, model: string) {
    onChangeStack({
      ...stack,
      roles: {
        ...stack.roles,
        chat: { providerId, model },
      },
    });
  }

  function setMemory(providerId: string, model: string) {
    onChangeStack({
      ...stack,
      roles: {
        ...stack.roles,
        memoryRefine: { providerId, model },
      },
    });
  }

  function setBinding(role: LlmRoleId, binding: RoleBinding) {
    if (role === "chat" || role === "memoryRefine") return;
    onChangeStack({
      ...stack,
      roles: { ...stack.roles, [role]: binding },
    });
  }

  const chat = stack.roles.chat;
  const chatCaps = resolveModelCapabilities(chat.model);
  const captionResolved = resolveRole(stack, "caption");
  const captionOk = modelSupportsRole(
    resolveModelCapabilities(captionResolved.model),
    "caption",
  );

  return (
    <div className="space-y-4">
      {rolesDisabled && (
        <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
          {t("settings.sections.llmConfig.noConfiguredForRoles")}
          {onGoProviders && (
            <button
              type="button"
              className="ml-1 underline"
              onClick={onGoProviders}
            >
              {t("settings.sections.llmConfig.goProviders")}
            </button>
          )}
        </div>
      )}

      {!captionOk && !rolesDisabled && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {t("settings.sections.llmConfig.captionWarning", {
            model: captionResolved.model,
            suggest: suggestMultimodalModel(chat.model) ?? "mimo-v2-omni",
          })}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              const suggest = suggestMultimodalModel(chat.model);
              if (!suggest) return;
              setBinding("caption", {
                mode: "custom",
                providerId: chat.providerId,
                model: suggest,
              });
            }}
          >
            {t("settings.sections.llmConfig.applySuggest")}
          </button>
        </div>
      )}

      <fieldset disabled={rolesDisabled} className="space-y-3 disabled:opacity-60">
        {ROLE_ROWS.map((row) => {
          if (row.role === "chat") {
            const models = modelOptionsForProvider(chat.providerId, providerConfigs, {
              currentModel: chat.model,
            });
            return (
              <div key={row.role} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {t(row.labelKey)}
                  <InfoTip label={t(row.hintKey)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">{t("settings.sections.llmConfig.provider")}</Label>
                    <ProviderSelect
                      value={chat.providerId}
                      options={providerOptions}
                      pendingSuffix={pendingSuffix}
                      onChange={(pid) =>
                        setChat(
                          pid,
                          modelOptionsForProvider(pid, providerConfigs)[0] ??
                            providerConfigs[pid]?.model ??
                            "",
                        )
                      }
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Label className="text-xs">
                        {t("settings.sections.llmConfig.model")}
                      </Label>
                      <ModelCapabilityBadges
                        modelId={chat.model}
                        className="inline-flex flex-wrap gap-0.5"
                      />
                    </div>
                    <select
                      className="wx-themed-select w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2 py-1.5 text-sm text-[var(--wx-text)]"
                      value={chat.model}
                      onChange={(e) => setChat(chat.providerId, e.target.value)}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          }

          if (row.role === "memoryRefine") {
            const mem = stack.roles.memoryRefine;
            const models = modelOptionsForProvider(mem.providerId, providerConfigs, {
              currentModel: mem.model,
            });
            return (
              <div key={row.role} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {t(row.labelKey)}
                  <InfoTip label={t(row.hintKey)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">{t("settings.sections.llmConfig.provider")}</Label>
                    <ProviderSelect
                      value={mem.providerId}
                      options={providerOptions}
                      pendingSuffix={pendingSuffix}
                      onChange={(pid) =>
                        setMemory(
                          pid,
                          modelOptionsForProvider(pid, providerConfigs)[0] ?? mem.model,
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t("settings.sections.llmConfig.model")}</Label>
                    <select
                      className="wx-themed-select mt-1 w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2 py-1.5 text-sm text-[var(--wx-text)]"
                      value={mem.model}
                      onChange={(e) => setMemory(mem.providerId, e.target.value)}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          }

          const binding = stack.roles[row.role];
          const resolved = resolveRole(stack, row.role);
          const supportsRole = row.filterRole
            ? modelSupportsRole(
                resolveModelCapabilities(resolved.model),
                row.filterRole,
              )
            : true;
          const customProviderId =
            binding.mode === "custom" ? binding.providerId : chat.providerId;

          return (
            <div key={row.role} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {t(row.labelKey)}
                <InfoTip label={t(row.hintKey)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">{t("settings.sections.llmConfig.provider")}</Label>
                  <ProviderSelect
                    value={customProviderId}
                    options={providerOptions}
                    pendingSuffix={pendingSuffix}
                    onChange={(pid) => {
                      setBinding(row.role, {
                        mode: "custom",
                        providerId: pid,
                        model:
                          modelOptionsForProvider(pid, providerConfigs, {
                            filterRole: row.filterRole,
                          })[0] ??
                          providerConfigs[pid]?.model ??
                          "",
                      });
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Label className="text-xs">
                      {t("settings.sections.llmConfig.model")}
                    </Label>
                    <ModelCapabilityBadges
                      modelId={resolved.model}
                      className="inline-flex flex-wrap gap-0.5"
                    />
                  </div>
                  <select
                    className="wx-themed-select w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-2 py-1.5 text-sm text-[var(--wx-text)]"
                    value={resolved.model}
                    onChange={(e) => {
                      setBinding(row.role, {
                        mode: "custom",
                        providerId: customProviderId,
                        model: e.target.value,
                      });
                    }}
                  >
                    {modelOptionsForProvider(customProviderId, providerConfigs, {
                      filterRole: row.filterRole,
                      currentModel: resolved.model,
                    }).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {row.role === "wikiIngestCaption" && (
                <>
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      supportsRole
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                    }`}
                  >
                    {t(
                      supportsRole
                        ? "settings.sections.llmConfig.roles.wikiIngestVisionSupported"
                        : "settings.sections.llmConfig.roles.wikiIngestVisionUnsupported",
                      { model: resolved.model },
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={binding.enabled !== false && supportsRole}
                      disabled={!supportsRole}
                      onChange={(e) =>
                        setBinding(row.role, {
                          ...binding,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    {t("settings.sections.llmConfig.roles.wikiIngestEnable")}
                  </label>
                  {binding.enabled !== false && (
                    <>
                      <div className="space-y-2 rounded-md border p-3">
                        <Label className="text-xs">
                          {t("settings.sections.llmConfig.roles.wikiIngestConcurrency")}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={16}
                          step={1}
                          className="max-w-[8rem]"
                          value={stack.wikiIngestConcurrency ?? 4}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            onChangeStack({
                              ...stack,
                              wikiIngestConcurrency: Math.max(
                                1,
                                Math.min(16, Number.isFinite(n) ? n : 4),
                              ),
                            });
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("settings.sections.llmConfig.roles.wikiIngestConcurrencyHint")}
                        </p>
                      </div>
                      <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                        <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
                          {t("settings.sections.llmConfig.roles.wikiIngestCostHeading")}
                        </div>
                        <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
                          {[1, 2, 3, 4].map((i) => (
                            <li key={i}>
                              {t(`settings.sections.llmConfig.roles.wikiIngestCostPoint${i}`)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        {t("settings.sections.llmConfig.chatCapsNote", {
          tags: chatCaps.vision ? t("settings.sections.llmConfig.hasVision") : t("settings.sections.llmConfig.textOnly"),
        })}
      </p>
    </div>
  );
}
