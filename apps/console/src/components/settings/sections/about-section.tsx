import { useTranslation } from "react-i18next"
import { openUrl } from "@tauri-apps/plugin-opener"
import { CococatAboutPanel } from "@/components/settings/sections/cococat-about-panel"

export function AboutSection() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.about.title")}</h2>
      </div>

      <div className="rounded-md border divide-y">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm text-muted-foreground">
            {t("settings.sections.about.version")}
          </span>
          <span className="font-mono text-sm">v{__APP_VERSION__}</span>
        </div>
      </div>

      <CococatAboutPanel />

      <div className="rounded-md border p-4 text-sm">
        <div className="font-medium">CocoCat</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.sections.about.appDescription")}{" "}
          <a
            className="cursor-pointer underline underline-offset-2 hover:text-primary"
            href="https://github.com/nashsu/apps/console"
            onClick={(e) => {
              e.preventDefault()
              void openUrl("https://github.com/nashsu/apps/console").catch((err) => {
                console.error("[about] openUrl failed:", err)
              })
            }}
          >
            github.com/nashsu/apps/console
          </a>
        </p>
      </div>
    </div>
  )
}
