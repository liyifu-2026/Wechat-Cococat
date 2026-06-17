import { refreshStackHealth } from "@/hooks/use-stack-health"
import { fetchStackHealthSnapshot } from "@/lib/stack-health-snapshot"
import {
  stackCommand,
  type StackHealthService,
} from "@/lib/stack-client"

export type StackOrchestratorPhase = StackHealthService

export type StackOrchestratorProgress = {
  action: "start" | "stop"
  phase: StackOrchestratorPhase | null
  step: number
  totalSteps: number
  percent: number
  logs: string[]
}

const START_ORDER: StackOrchestratorPhase[] = ["driver", "memory", "agent"]
const STOP_ORDER: StackOrchestratorPhase[] = ["agent", "memory", "driver"]

async function buildStartPlan(): Promise<StackOrchestratorPhase[]> {
  const snap = await fetchStackHealthSnapshot(true)
  if (!snap) return [...START_ORDER]

  const plan: StackOrchestratorPhase[] = []
  for (const svc of START_ORDER) {
    if (snap[svc] !== "up") {
      plan.push(svc)
    }
  }
  return plan
}

async function startService(
  svc: StackOrchestratorPhase,
  logs: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const out = await stackCommand(svc, "start")
    const trimmed = out.trim()
    if (trimmed) logs.push(trimmed)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (svc === "memory") {
      logs.push(`memory: optional — ${msg}`)
      return { ok: true }
    }
    logs.push(msg)
    return { ok: false, error: msg }
  }
}

export async function runStackOrchestrator(
  action: "start" | "stop",
  onProgress: (progress: StackOrchestratorProgress) => void,
): Promise<{ ok: boolean; logs: string[]; error?: string }> {
  if (action === "start") {
    return runStackStart(onProgress)
  }
  return runStackStop(onProgress)
}

async function runStackStart(
  onProgress: (progress: StackOrchestratorProgress) => void,
): Promise<{ ok: boolean; logs: string[]; error?: string }> {
  const logs: string[] = []
  const plan = await buildStartPlan()

  const emit = (
    phase: StackOrchestratorPhase | null,
    step: number,
    totalSteps: number,
    percent: number,
  ) => {
    onProgress({
      action: "start",
      phase,
      step,
      totalSteps,
      percent,
      logs: [...logs],
    })
  }

  if (plan.length === 0) {
    logs.push("stack: all services already up")
    await refreshStackHealth(true)
    emit(null, 0, 0, 100)
    return { ok: true, logs }
  }

  const totalSteps = plan.length
  let step = 0

  if (plan.includes("driver")) {
    step += 1
    emit("driver", step, totalSteps, Math.round((step / totalSteps) * 100))
    const result = await startService("driver", logs)
    if (!result.ok) {
      emit("driver", step, totalSteps, Math.round((step / totalSteps) * 100))
      await refreshStackHealth(true)
      return { ok: false, logs, error: result.error }
    }
  }

  const parallel = plan.filter((svc) => svc === "memory" || svc === "agent")
  if (parallel.length > 0) {
    emit(parallel[0]!, step, totalSteps, Math.round((step / totalSteps) * 100))
    const results = await Promise.all(
      parallel.map(async (svc) => ({
        svc,
        result: await startService(svc, logs),
      })),
    )
    for (const { svc, result } of results) {
      step += 1
      emit(svc, step, totalSteps, Math.round((step / totalSteps) * 100))
      if (!result.ok) {
        await refreshStackHealth(true)
        return { ok: false, logs, error: result.error }
      }
    }
  }

  await refreshStackHealth(true)
  emit(null, totalSteps, totalSteps, 100)
  return { ok: true, logs }
}

async function runStackStop(
  onProgress: (progress: StackOrchestratorProgress) => void,
): Promise<{ ok: boolean; logs: string[]; error?: string }> {
  const order = STOP_ORDER
  const logs: string[] = []

  const emit = (
    phase: StackOrchestratorPhase | null,
    step: number,
    percent: number,
  ) => {
    onProgress({
      action: "stop",
      phase,
      step,
      totalSteps: order.length,
      percent,
      logs: [...logs],
    })
  }

  for (let i = 0; i < order.length; i++) {
    const svc = order[i]!
    emit(svc, i + 1, Math.round((i / order.length) * 100))

    try {
      const out = await stackCommand(svc, "stop")
      const trimmed = out.trim()
      if (trimmed) logs.push(trimmed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logs.push(msg)
      emit(svc, i + 1, Math.round(((i + 1) / order.length) * 100))
      await refreshStackHealth(true)
      return { ok: false, logs, error: msg }
    }

    emit(svc, i + 1, Math.round(((i + 1) / order.length) * 100))
  }

  await refreshStackHealth(true)
  emit(null, order.length, 100)
  return { ok: true, logs }
}
