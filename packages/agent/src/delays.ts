import type { DelayRange } from "./style.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveDelayMs(range: DelayRange, fallback = 0): number {
  if (range === null || range === undefined) return fallback;
  if (typeof range === "number") return Math.max(0, range);
  const [min, max] = range;
  if (min >= max) return Math.max(0, min);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function applyDelay(range: DelayRange, fallback = 0): Promise<void> {
  const ms = resolveDelayMs(range, fallback);
  if (ms > 0) await sleep(ms);
}
