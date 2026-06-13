/** Inbox / 画像「相处要点」展示态 — 区分基础设施与 per-chat 内容。 */
export type MemoryDisplayState = "offline" | "empty" | "ready"

export function resolveMemoryDisplayState(
  gatewayUp: boolean,
  lines: string[],
): MemoryDisplayState {
  if (!gatewayUp) return "offline"
  if (lines.length === 0) return "empty"
  return "ready"
}

export function isMemoryGatewayHealthy(
  stackMemoryUp: boolean,
  healthStatus: string | undefined,
): boolean {
  return stackMemoryUp && healthStatus === "ok"
}
