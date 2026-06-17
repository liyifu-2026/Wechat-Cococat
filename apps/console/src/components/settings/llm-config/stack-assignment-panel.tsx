import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LlmStackFile } from "@cococat/shared/llm-stack"
import { Button } from "@/components/ui/button"
import type { ProviderConfigs } from "@/stores/wiki-store"
import { RoleAssignmentTab } from "./role-assignment-tab"
import { EffectiveStatusTab } from "./effective-status-tab"

type StackAssignmentPanelProps = {
  stack: LlmStackFile
  providerConfigs: ProviderConfigs
  dirty: boolean
  onChangeStack: (next: LlmStackFile) => void
  onGoProviders: () => void
  /** After save, parent sets this to show status view. */
  forceStatusView?: boolean
  onEditingChange?: (editing: boolean) => void
}

export function StackAssignmentPanel({
  stack,
  providerConfigs,
  dirty,
  onChangeStack,
  onGoProviders,
  forceStatusView = false,
  onEditingChange,
}: StackAssignmentPanelProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  const showStatus = !dirty && !editing && (forceStatusView || !editing)

  useEffect(() => {
    if (dirty) setEditing(true)
  }, [dirty])

  useEffect(() => {
    if (forceStatusView) setEditing(false)
  }, [forceStatusView])

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  if (showStatus && !dirty) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.sections.llmConfig.editRoles")}
          </Button>
        </div>
        <EffectiveStatusTab stack={stack} dirty={false} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!dirty && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            {t("settings.sections.llmConfig.backToStatus")}
          </Button>
        </div>
      )}
      <RoleAssignmentTab
        stack={stack}
        providerConfigs={providerConfigs}
        onChangeStack={onChangeStack}
        onGoProviders={onGoProviders}
      />
    </div>
  )
}
