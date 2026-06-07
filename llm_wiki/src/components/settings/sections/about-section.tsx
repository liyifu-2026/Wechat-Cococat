import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { openUrl } from "@tauri-apps/plugin-opener"
import { apiServerStatus } from "@/commands/fs"
import { API_SERVER_HEALTH_URL, API_SERVER_PORT } from "@/lib/api-server-constants"

interface ApiHealth {
  enabled?: boolean
  authConfigured?: boolean
  allowUnauthenticated?: boolean
}

export function AboutSection() {
  const { t } = useTranslation()
  const [apiStatus, setApiStatus] = useState<string>("...")
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)

  useEffect(() => {
    let alive = true
    apiServerStatus()
      .then((s) => {
        if (alive) setApiStatus(s)
      })
      .catch(() => {
        if (alive) setApiStatus("unknown")
      })
    fetch(API_SERVER_HEALTH_URL)
      .then((res) => res.json() as Promise<ApiHealth>)
      .then((value) => {
        if (alive) setApiHealth(value)
      })
      .catch(() => {
        if (alive) setApiHealth(null)
      })
    return () => {
      alive = false
    }
  }, [])

  const apiStatusDisplay = (() => {
    if (apiStatus === "running" && apiHealth?.enabled === false) {
      return t("settings.sections.about.apiDisabled")
    }
    if (apiStatus === "running" && apiHealth?.allowUnauthenticated) {
      return t("settings.sections.about.apiOpen")
    }
    if (apiStatus === "running" && apiHealth?.authConfigured === false) {
      return t("settings.sections.about.apiNoToken")
    }
    return apiStatus
  })()
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t("settings.sections.about.version"), value: `v${__APP_VERSION__}`, mono: true },
    { label: t("settings.sections.about.apiServer"), value: `${apiStatusDisplay}  @  127.0.0.1:${API_SERVER_PORT}`, mono: true },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.about.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.about.description")}
        </p>
      </div>

      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className={`text-sm ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-4 text-sm">
        <div className="font-medium">CocoCat</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.sections.about.appDescription")}
          {" "}
          {/*
           * Tauri 2's webview doesn't honor `target="_blank"` for
           * external URLs by default — clicking would either do
           * nothing or replace the in-app webview with the github
           * page (terrible UX). Route through the opener plugin
           * via onClick + preventDefault so it always lands in the
           * system browser.
           */}
          <a
            className="cursor-pointer underline underline-offset-2 hover:text-primary"
            href="https://github.com/nashsu/llm_wiki"
            onClick={(e) => {
              e.preventDefault()
              void openUrl("https://github.com/nashsu/llm_wiki").catch((err) => {
                console.error("[about] openUrl failed:", err)
              })
            }}
          >
            github.com/nashsu/llm_wiki
          </a>
        </p>
      </div>
    </div>
  )
}
