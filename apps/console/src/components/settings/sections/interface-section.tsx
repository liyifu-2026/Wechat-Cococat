import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import {
  getStackNotificationsEnabled,
  setStackNotificationsEnabled,
} from "@/lib/stack-notifications"
import {
  getStoredThemeMode,
  setThemeMode,
  type ThemeMode,
} from "@/lib/theme"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const UI_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

const THEME_MODES: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.sections.interface.themeSystem" },
  { value: "light", labelKey: "settings.sections.interface.themeLight" },
  { value: "dark", labelKey: "settings.sections.interface.themeDark" },
]

export function InterfaceSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode())
  const [stackNotifications, setStackNotificationsState] = useState(() =>
    getStackNotificationsEnabled(),
  )

  function selectTheme(mode: ThemeMode) {
    setThemeModeState(mode)
    setThemeMode(mode)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.interface.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.interface.description")}
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stackNotifications}
            onChange={(e) => {
              setStackNotificationsState(e.target.checked)
              setStackNotificationsEnabled(e.target.checked)
            }}
          />
          {t("settings.sections.interface.stackNotifications")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.stackNotificationsHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("settings.sections.interface.theme")}</Label>
        <div className="flex flex-wrap gap-2">
          {THEME_MODES.map((mode) => {
            const active = themeMode === mode.value
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => selectTheme(mode.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {t(mode.labelKey)}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.themeHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("settings.sections.interface.uiLanguage")}</Label>
        <div className="flex flex-wrap gap-2">
          {UI_LANGUAGES.map((l) => {
            const active = draft.uiLanguage === l.value
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => setDraft("uiLanguage", l.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {l.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.uiLanguageHint")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.systemLanguageHint")}
        </p>
      </div>
    </div>
  )
}
