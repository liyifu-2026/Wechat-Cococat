const STORAGE_KEY = "wechat.composeHeight"

export const DEFAULT_COMPOSE_HEIGHT = 184
export const MIN_COMPOSE_HEIGHT = 112
export const MAX_COMPOSE_HEIGHT = 360

export function clampComposeHeight(px: number): number {
  return Math.min(MAX_COMPOSE_HEIGHT, Math.max(MIN_COMPOSE_HEIGHT, px))
}

export function readStoredComposeHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_COMPOSE_HEIGHT
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? clampComposeHeight(n) : DEFAULT_COMPOSE_HEIGHT
  } catch {
    return DEFAULT_COMPOSE_HEIGHT
  }
}

export function persistComposeHeight(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampComposeHeight(px)))
  } catch {
    // ignore quota errors
  }
}
