import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, LogIn, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/console/status-badge"
import {
  refreshStackHealth,
  useStackHealth,
} from "@/hooks/use-stack-health"
import { DRIVER_BASE_URL } from "@/lib/cococat-endpoints"
import { CONSOLE_PANEL } from "@/lib/console-ui"
import {
  fetchDriverScreenshot,
  logoutDriver,
  openDriverLoginSocket,
  type LoginSubscriptionEvent,
} from "@/lib/driver-client"
import { readCococatToken } from "@/lib/stack-client"
import { wechatAuthHealth } from "@/lib/wechat-ui"
import { useConsoleStore } from "@/stores/console-store"
import { cn } from "@/lib/utils"

export function SystemWechatConnect() {
  const { t } = useTranslation()
  const health = useStackHealth()
  const navigateSystem = useConsoleStore((s) => s.navigateSystem)
  const consumePendingWechatTroubleshoot = useConsoleStore(
    (s) => s.consumePendingWechatTroubleshoot,
  )
  const troubleshootPending = consumePendingWechatTroubleshoot()

  const driverUp = health.driver === "up"
  const authStatus = health.wechatAuthStatus
  const loggedInUser = health.wechatLoggedInUser
  const chatsReady = health.chatsReady
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginStatus, setLoginStatus] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const [troubleshootOpen, setTroubleshootOpen] = useState(troubleshootPending)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const loginDoneRef = useRef(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const troubleshootRef = useRef<HTMLDetailsElement | null>(null)

  const vncUrl = token
    ? `${DRIVER_BASE_URL}/vnc/?token=${encodeURIComponent(token)}&autoconnect=true&reconnect=true&reconnect_delay=2000`
    : null
  const showVnc = Boolean(vncUrl && driverUp && !error)

  const authLabel =
    authStatus === "logged_in" || authStatus === "logged_out"
      ? t(`console.wechat.authStatus.${authStatus}`)
      : authStatus

  useEffect(() => {
    void readCococatToken()
      .then(setToken)
      .catch(() => setToken(null))
  }, [])

  const refreshScreenshot = useCallback(async () => {
    if (!driverUp) return
    setScreenshotLoading(true)
    setScreenshotError(null)
    try {
      setScreenshotUrl(await fetchDriverScreenshot())
    } catch (err) {
      setScreenshotUrl(null)
      setScreenshotError(err instanceof Error ? err.message : String(err))
    } finally {
      setScreenshotLoading(false)
    }
  }, [driverUp])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await refreshStackHealth()
      await refreshScreenshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [refreshScreenshot])

  useEffect(() => {
    if (driverUp) void refreshScreenshot()
  }, [driverUp, refreshScreenshot])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!troubleshootPending) return
    setTroubleshootOpen(true)
    const id = window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      troubleshootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, 120)
    return () => window.clearTimeout(id)
  }, [troubleshootPending])

  function handleLoginEvent(event: LoginSubscriptionEvent) {
    switch (event.type) {
      case "status":
        setLoginStatus(event.message)
        break
      case "qr":
        if (event.qrDataUrl) setQrDataUrl(event.qrDataUrl)
        setLoginStatus(t("console.wechat.qrScanHint"))
        break
      case "phone_confirm":
        setLoginStatus(event.message ?? t("console.wechat.phoneConfirm"))
        break
      case "login_success":
        loginDoneRef.current = true
        setLoginStatus(t("console.wechat.loginSuccess"))
        setLoginOpen(false)
        void refreshStackHealth().then(() => refreshScreenshot())
        break
      case "login_timeout":
        loginDoneRef.current = true
        setLoginStatus(t("console.wechat.loginTimeout"))
        setLoginOpen(false)
        break
      case "error":
        loginDoneRef.current = true
        setLoginStatus(event.message)
        setLoginOpen(false)
        break
    }
  }

  async function startLogin() {
    wsRef.current?.close()
    loginDoneRef.current = false
    setLoginOpen(true)
    setLoginStatus(t("console.wechat.loginStarting"))
    setQrDataUrl(null)
    try {
      const ws = await openDriverLoginSocket({
        onEvent: handleLoginEvent,
        onError: (err) => {
          loginDoneRef.current = true
          setLoginStatus(err.message)
          setLoginOpen(false)
        },
        onClose: () => {
          if (!loginDoneRef.current) {
            setLoginStatus(t("console.wechat.loginDisconnected"))
            setLoginOpen(false)
          }
        },
      })
      wsRef.current = ws
    } catch (err) {
      setLoginStatus(err instanceof Error ? err.message : String(err))
      setLoginOpen(false)
    }
  }

  function stopLogin() {
    wsRef.current?.close()
    wsRef.current = null
    setLoginOpen(false)
  }

  async function handleLogout() {
    setLogoutBusy(true)
    try {
      const result = await logoutDriver()
      if (!result.success) {
        setError(result.error ?? t("console.system.wechat.logoutFailed"))
      }
      await refreshStackHealth()
      await refreshScreenshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogoutBusy(false)
    }
  }

  const driverBlockedHint =
    health.driver === "degraded"
      ? t("wechat.inbox.chatsDriverUnreachable")
      : t("console.system.wechat.driverDown")

  return (
    <div
      id="system-wechat-connect"
      ref={sectionRef}
      className="mt-8 border-t pt-8"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("console.system.wechat.sectionTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("console.system.wechat.sectionHint")}
        </p>
      </div>

      {health.wechatLoggedIn && !chatsReady && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          <p>{t("wechat.inbox.chatsDbNotReady")}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={refreshing}
            onClick={() => void refreshAll()}
          >
            {t("wechat.inbox.syncWechatDb")}
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => navigateSystem("services", "driver")}
          >
            {t("console.wechat.goToStack")}
          </Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">
          {loggedInUser
            ? t("console.system.wechat.account", { name: loggedInUser })
            : t("console.system.wechat.accountUnknown")}
        </span>
        <StatusBadge health={wechatAuthHealth(authStatus)} label={authLabel} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          disabled={refreshing || health.loading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshing || health.loading ? "animate-spin" : ""}`}
          />
          {t("console.refresh")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={CONSOLE_PANEL}>
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            {t("console.system.wechat.qrPrimary")}
          </p>
          {authStatus === "logged_in" && !loginOpen ? (
            <p className="text-sm text-muted-foreground">
              {t("console.system.wechat.loggedInHint")}
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {driverUp && authStatus !== "logged_in" && (
                  <>
                    <Button size="sm" onClick={() => void startLogin()} disabled={loginOpen}>
                      <LogIn className="mr-2 h-4 w-4" />
                      {t("console.wechat.startLogin")}
                    </Button>
                    {loginOpen && (
                      <Button size="sm" variant="outline" onClick={stopLogin}>
                        {t("console.wechat.stopLogin")}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {(loginOpen || qrDataUrl) && (
                <div className="text-center">
                  {loginStatus && (
                    <p className="mb-2 text-sm text-muted-foreground">{loginStatus}</p>
                  )}
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt="WeChat QR"
                      className="mx-auto max-h-52 rounded-lg border bg-white p-2"
                    />
                  )}
                </div>
              )}
              {!loginOpen && !qrDataUrl && authStatus !== "logged_in" && driverUp && (
                <p className="text-sm text-muted-foreground">
                  {t("console.wechat.loginPrompt")}
                </p>
              )}
              {!driverUp && (
                <p className="text-sm text-muted-foreground">{driverBlockedHint}</p>
              )}
            </>
          )}
        </div>

        <div className={CONSOLE_PANEL}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("console.system.wechat.screenshotSecondary")}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!driverUp || screenshotLoading}
              onClick={() => void refreshScreenshot()}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${screenshotLoading ? "animate-spin" : ""}`}
              />
              {t("console.system.wechat.refreshScreenshot")}
            </Button>
          </div>
          {screenshotError && (
            <p className="mb-2 text-xs text-destructive">{screenshotError}</p>
          )}
          {screenshotUrl ? (
            <img
              src={screenshotUrl}
              alt={t("console.system.wechat.screenshotAlt")}
              className="max-h-52 w-full rounded-md border bg-black/20 object-contain"
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
              {driverUp
                ? t("console.system.wechat.screenshotEmpty")
                : driverBlockedHint}
            </div>
          )}
        </div>
      </div>

      <details
        ref={troubleshootRef}
        open={troubleshootOpen}
        onToggle={(e) => setTroubleshootOpen(e.currentTarget.open)}
        className={cn(CONSOLE_PANEL, "mt-4")}
      >
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                {t("console.system.wechat.troubleshootTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("console.system.wechat.troubleshootHint")}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {troubleshootOpen
                ? t("console.system.wechat.collapse")
                : t("console.system.wechat.expand")}
            </span>
          </div>
        </summary>

        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            {vncUrl && (
              <a
                href={vncUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("console.wechat.openVncBrowser")}
              </a>
            )}
            {authStatus === "logged_in" && (
              <Button
                size="sm"
                variant="outline"
                disabled={logoutBusy || !driverUp}
                onClick={() => void handleLogout()}
              >
                {t("console.system.wechat.logout")}
              </Button>
            )}
          </div>

          {showVnc ? (
            <div className="overflow-hidden rounded-md border">
              <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {t("console.wechat.vncConnectingHint")}{" "}
                <a
                  href={vncUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  {t("console.wechat.openVncBrowser")}
                </a>
              </p>
              <iframe
                title={t("console.wechat.vnc")}
                src={vncUrl!}
                className="aspect-video min-h-[240px] w-full border-0 bg-black"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("console.wechat.vncUnavailable")}
            </p>
          )}
        </div>
      </details>
    </div>
  )
}
