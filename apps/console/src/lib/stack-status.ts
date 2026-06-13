export type ServiceHealth = "up" | "down" | "degraded" | "unknown"

export function parseStackStatusLine(line: string): ServiceHealth {
  const trimmed = line.trim()
  if (!trimmed) return "unknown"
  if (/:\s*up\b/i.test(trimmed)) return "up"
  if (/:\s*down\b/i.test(trimmed)) return "down"
  if (/unreachable|failed|error|but health/i.test(trimmed)) return "degraded"
  return "unknown"
}

export const STACK_CLI_HINTS: Record<
  "driver" | "memory" | "agent" | "all",
  { start: string; stop: string }
> = {
  driver: {
    start: "pnpm stack start driver",
    stop: "pnpm stack stop driver",
  },
  memory: {
    start: "pnpm stack start memory",
    stop: "pnpm stack stop memory",
  },
  agent: {
    start: "pnpm stack start agent",
    stop: "pnpm stack stop agent",
  },
  all: {
    start: "pnpm stack start all",
    stop: "pnpm stack stop all",
  },
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
