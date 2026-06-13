import type { ConsoleModule } from "@/lib/console-layout"

export interface VisibilityGatingOptions {
  /** Modules that receive full-frequency polling */
  allowedModules?: readonly ConsoleModule[]
  /** Pause entirely when the tab/window is hidden */
  suspendWhenHidden?: boolean
  /** Interval when visible but outside allowedModules; omit to suspend instead */
  degradedIntervalMs?: number
}

export interface VisibilityGateContext {
  hidden: boolean
  activeModule: ConsoleModule
}

/** Resolve the next poll delay, or null when polling should pause. */
export function resolveGatedDelayMs(
  baseDelayMs: number,
  ctx: VisibilityGateContext,
  options: VisibilityGatingOptions = {},
): number | null {
  const { allowedModules, suspendWhenHidden = true, degradedIntervalMs } = options

  if (baseDelayMs <= 0) return null
  if (ctx.hidden && suspendWhenHidden) return null

  if (allowedModules && !allowedModules.includes(ctx.activeModule)) {
    return degradedIntervalMs ?? null
  }

  return baseDelayMs
}
