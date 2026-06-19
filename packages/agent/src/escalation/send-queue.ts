const MAX_CONCURRENT_SENDS = 4;
let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_SENDS) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  waiters.shift()?.();
}

export function enqueueSend<T>(fn: () => Promise<T>): Promise<T> {
  return (async () => {
    await acquireSlot();
    try {
      return await fn();
    } finally {
      releaseSlot();
    }
  })();
}
