import { useTranslation } from "react-i18next"
import type { AiAssistMode } from "@/stores/ai-assist-store"

type InboxAiModeSwitchProps = {
  mode: AiAssistMode
  onModeChange: (mode: AiAssistMode) => void
}

export function InboxAiModeSwitch({ mode, onModeChange }: InboxAiModeSwitchProps) {
  const { t } = useTranslation()

  return (
    <div className="flex justify-center">
      <div
        className="inbox-ai-mode-switch"
        data-mode={mode}
        role="tablist"
        aria-label={t("wechat.aiAssist.title")}
      >
        <div className="inbox-ai-mode-switch__thumb" aria-hidden />
        <button
          type="button"
          role="tab"
          aria-selected={mode === "assist"}
          className={`inbox-ai-mode-switch__btn ${mode === "assist" ? "inbox-ai-mode-switch__btn--active" : ""}`}
          onClick={() => onModeChange("assist")}
        >
          {t("wechat.aiAssist.modeAssistShort")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "search"}
          className={`inbox-ai-mode-switch__btn ${mode === "search" ? "inbox-ai-mode-switch__btn--active" : ""}`}
          onClick={() => onModeChange("search")}
        >
          {t("wechat.aiAssist.modeSearchShort")}
        </button>
      </div>
    </div>
  )
}
