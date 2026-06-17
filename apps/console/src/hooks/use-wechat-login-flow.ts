import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { refreshStackHealth } from "@/hooks/use-stack-health"
import {
  openDriverLoginSocket,
  type LoginSubscriptionEvent,
} from "@/lib/driver-client"

export type WechatLoginPhase =
  | "idle"
  | "connecting"
  | "qr"
  | "phone_confirm"
  | "logging_in"
  | "success"
  | "error"

export type WechatLoginFlowState = {
  phase: WechatLoginPhase
  statusText: string | null
  qrDataUrl: string | null
  error: string | null
}

export function useWechatLoginFlow(options?: {
  autoStart?: boolean
  onSuccess?: () => void
}) {
  const { t } = useTranslation()
  const wsRef = useRef<WebSocket | null>(null)
  const loginDoneRef = useRef(false)
  const [state, setState] = useState<WechatLoginFlowState>({
    phase: "idle",
    statusText: null,
    qrDataUrl: null,
    error: null,
  })

  const stop = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const handleEvent = useCallback(
    (event: LoginSubscriptionEvent) => {
      switch (event.type) {
        case "status":
          setState((prev) => ({
            ...prev,
            phase: prev.phase === "qr" ? "qr" : "connecting",
            statusText: event.message,
            error: null,
          }))
          break
        case "qr":
          setState({
            phase: "qr",
            statusText: t("wechat.login.qrScanHint"),
            qrDataUrl: event.qrDataUrl ?? null,
            error: null,
          })
          break
        case "phone_confirm":
          setState({
            phase: "phone_confirm",
            statusText: event.message ?? t("wechat.login.phoneConfirm"),
            qrDataUrl: null,
            error: null,
          })
          break
        case "login_account":
          setState({
            phase: "logging_in",
            statusText: event.message ?? t("wechat.login.loginAccount"),
            qrDataUrl: null,
            error: null,
          })
          break
        case "login_success":
          loginDoneRef.current = true
          setState({
            phase: "success",
            statusText: t("wechat.login.loginSuccess"),
            qrDataUrl: null,
            error: null,
          })
          stop()
          void refreshStackHealth().then(() => options?.onSuccess?.())
          break
        case "login_timeout":
          loginDoneRef.current = true
          setState({
            phase: "error",
            statusText: t("wechat.login.loginTimeout"),
            qrDataUrl: null,
            error: t("wechat.login.loginTimeout"),
          })
          stop()
          break
        case "error":
          loginDoneRef.current = true
          setState({
            phase: "error",
            statusText: event.message,
            qrDataUrl: null,
            error: event.message,
          })
          stop()
          break
      }
    },
    [options, stop, t],
  )

  const start = useCallback(async () => {
    stop()
    loginDoneRef.current = false
    setState({
      phase: "connecting",
      statusText: t("wechat.login.loginStarting"),
      qrDataUrl: null,
      error: null,
    })
    try {
      const ws = await openDriverLoginSocket({
        onEvent: handleEvent,
        onError: (err) => {
          loginDoneRef.current = true
          setState({
            phase: "error",
            statusText: err.message,
            qrDataUrl: null,
            error: err.message,
          })
        },
        onClose: () => {
          if (!loginDoneRef.current) {
            setState((prev) =>
              prev.phase === "success"
                ? prev
                : {
                    phase: "error",
                    statusText: t("wechat.login.loginDisconnected"),
                    qrDataUrl: null,
                    error: t("wechat.login.loginDisconnected"),
                  },
            )
          }
        },
      })
      wsRef.current = ws
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({
        phase: "error",
        statusText: message,
        qrDataUrl: null,
        error: message,
      })
    }
  }, [handleEvent, stop, t])

  useEffect(() => {
    if (!options?.autoStart) return
    void start()
    return () => stop()
    // start/stop intentionally omitted — only react to autoStart gate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.autoStart])

  return { ...state, start, stop }
}
