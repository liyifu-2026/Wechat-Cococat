import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { refreshStackHealth } from "@/hooks/use-stack-health"
import { fetchDriverSessionAuth } from "@/lib/driver-client"
import { runStackOrchestrator, type StackOrchestratorPhase } from "@/lib/stack-orchestrator"
import { isFetchNetworkError } from "@/lib/tauri-fetch"

const STARTUP_TIMEOUT_MS = 120_000
const MIN_POLL_MS = 2_000
const MAX_POLL_MS = 8_000

export type SeamlessStartupPhase =
  | "booting"
  | "login_required"
  | "ready"
  | "error"

const PHASE_LABEL_KEYS: Record<
  StackOrchestratorPhase,
  "console.stack.phaseDriver" | "console.stack.phaseMemory" | "console.stack.phaseAgent"
> = {
  driver: "console.stack.phaseDriver",
  memory: "console.stack.phaseMemory",
  agent: "console.stack.phaseAgent",
}

export type SeamlessStartupState = {
  phase: SeamlessStartupPhase
  loggedIn: boolean
  errorMessage: string | null
  bootStatus: string | null
  retry: () => void
  completeLogin: () => void
}

export function useSeamlessStartup(): SeamlessStartupState {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<SeamlessStartupPhase>("booting")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [bootStatus, setBootStatus] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const runIdRef = useRef(0)

  const completeLogin = useCallback(() => {
    setLoggedIn(true)
    setPhase("ready")
    setErrorMessage(null)
    setBootStatus(null)
  }, [])

  const runBoot = useCallback(async () => {
    const runId = ++runIdRef.current
    setPhase("booting")
    setErrorMessage(null)
    setBootStatus(t("wechat.startup.booting"))
    setLoggedIn(false)

    const startedAt = Date.now()
    let pollMs = MIN_POLL_MS

    try {
      setBootStatus(t("wechat.startup.startingServices"))
      const [, result] = await Promise.all([
        refreshStackHealth(true),
        runStackOrchestrator("start", (progress) => {
          if (runId !== runIdRef.current) return
          const label = progress.phase
            ? t(PHASE_LABEL_KEYS[progress.phase])
            : t("wechat.startup.startingServices")
          setBootStatus(label)
        }),
      ])
      if (runId !== runIdRef.current) return
      if (!result.ok) {
        setPhase("error")
        setErrorMessage(result.error ?? t("wechat.startup.serviceFailed"))
        return
      }
    } catch (err) {
      if (runId !== runIdRef.current) return
      setPhase("error")
      setErrorMessage(err instanceof Error ? err.message : String(err))
      return
    }

    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
      if (runId !== runIdRef.current) return
      await refreshStackHealth(true)

      try {
        const auth = await fetchDriverSessionAuth()
        if (auth.status === "logged_in") {
          setLoggedIn(true)
          setPhase("ready")
          setBootStatus(null)
          return
        }
        if (auth.status === "logged_out") {
          setLoggedIn(false)
          setPhase("login_required")
          setBootStatus(null)
          return
        }
      } catch (err) {
        if (!isFetchNetworkError(err)) {
          setPhase("error")
          setErrorMessage(err instanceof Error ? err.message : String(err))
          return
        }
      }

      setBootStatus(t("wechat.startup.waitingWechat"))
      await new Promise((r) => setTimeout(r, pollMs))
      pollMs = Math.min(MAX_POLL_MS, Math.round(pollMs * 1.4))
    }

    if (runId !== runIdRef.current) return
    setPhase("error")
    setErrorMessage(t("wechat.startup.timeout"))
  }, [t])

  useEffect(() => {
    void runBoot()
    return () => {
      runIdRef.current += 1
    }
  }, [runBoot])

  const retry = useCallback(() => {
    void runBoot()
  }, [runBoot])

  return {
    phase,
    loggedIn,
    errorMessage,
    bootStatus,
    retry,
    completeLogin,
  }
}
