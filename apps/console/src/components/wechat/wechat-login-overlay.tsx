import { Loader2, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { WechatLoginTitleBar } from "@/components/wechat/wechat-window-controls"
import { useWechatLoginFlow } from "@/hooks/use-wechat-login-flow"
import type { SeamlessStartupPhase } from "@/hooks/use-seamless-startup"
import { useConsoleStore } from "@/stores/console-store"

type WechatLoginOverlayProps = {
  phase: SeamlessStartupPhase
  bootStatus: string | null
  errorMessage: string | null
  onRetryBoot: () => void
  onLoginSuccess: () => void
}

export function WechatLoginOverlay({
  phase,
  bootStatus,
  errorMessage,
  onRetryBoot,
  onLoginSuccess,
}: WechatLoginOverlayProps) {
  const { t } = useTranslation()
  const openSettingsModal = useConsoleStore((s) => s.openSettingsModal)
  const loginRequired = phase === "login_required"
  const login = useWechatLoginFlow({
    autoStart: loginRequired,
    onSuccess: onLoginSuccess,
  })

  const showOverlay =
    phase === "booting" || phase === "login_required" || phase === "error"
  if (!showOverlay) return null

  const openOps = () =>
    openSettingsModal({ group: "system-advanced", tab: "about" })

  return (
    <>
      <WechatLoginTitleBar />
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--wechat-dark-bg)] p-6">
      <div className="w-full max-w-sm rounded-xl border border-[var(--wx-border)] bg-[var(--wechat-dark-panel)] p-8 text-center shadow-2xl">
        {phase === "booting" && (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-[var(--wechat-brand)]" />
            <h1 className="text-lg font-medium text-[var(--wx-text)]">
              {t("wechat.login.bootTitle")}
            </h1>
            <p className="mt-2 text-sm text-[var(--wx-muted)]">
              {bootStatus ?? t("wechat.startup.booting")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-6 text-xs text-[var(--wx-muted)]"
              onClick={openOps}
            >
              {t("wechat.login.advancedOps")}
            </Button>
          </>
        )}

        {phase === "login_required" && (
          <>
            {login.phase === "qr" && login.qrDataUrl ? (
              <img
                src={login.qrDataUrl}
                alt={t("wechat.login.qrAlt")}
                className="mx-auto mb-4 h-52 w-52 rounded-lg border border-[var(--wx-border)] bg-white p-2"
              />
            ) : login.phase === "error" ? null : (
              <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-[var(--wechat-brand)]" />
            )}
            <h1 className="text-lg font-medium text-[var(--wx-text)]">
              {login.phase === "logging_in"
                ? t("wechat.login.loginAccount")
                : t("wechat.login.title")}
            </h1>
            <p className="mt-2 text-sm text-[var(--wx-muted)]">
              {login.error ??
                login.statusText ??
                t("wechat.login.subtitle")}
            </p>
            {login.phase === "phone_confirm" && (
              <p className="mt-3 text-xs text-[var(--wx-muted)]">
                {t("wechat.login.phoneConfirm")}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void login.start()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("wechat.login.retry")}
              </Button>
              <Button variant="ghost" size="sm" onClick={openOps}>
                {t("wechat.login.advancedOps")}
              </Button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <h1 className="text-lg font-medium text-destructive">
              {t("wechat.login.errorTitle")}
            </h1>
            <p className="mt-2 text-sm text-[var(--wx-muted)]">
              {errorMessage ?? t("wechat.startup.timeout")}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button size="sm" onClick={onRetryBoot}>
                {t("wechat.login.retryBoot")}
              </Button>
              <Button variant="outline" size="sm" onClick={openOps}>
                {t("wechat.login.advancedOps")}
              </Button>
            </div>
          </>
        )}
      </div>
      </div>
    </>
  )
}
