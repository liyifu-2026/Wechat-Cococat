import type { Redis } from "ioredis";

const PENDING_PREFIX = "cococat:thoughtful_pending:";

function pendingKey(chatId: string): string {
  return `${PENDING_PREFIX}${chatId}`;
}

export async function addThoughtfulPendingLocalIds(
  redis: Redis,
  chatId: string,
  localIds: number[],
): Promise<void> {
  if (localIds.length === 0) return;
  await redis.sadd(pendingKey(chatId), ...localIds.map(String));
}

export async function listThoughtfulPendingLocalIds(
  redis: Redis,
  chatId: string,
): Promise<number[]> {
  const members = await redis.smembers(pendingKey(chatId));
  return members
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

/** 原子 drain：取出并清空 thoughtful pending SET。 */
export async function drainThoughtfulPendingLocalIds(
  redis: Redis,
  chatId: string,
): Promise<number[]> {
  const key = pendingKey(chatId);
  const pipeline = redis.multi();
  pipeline.smembers(key);
  pipeline.del(key);
  const results = await pipeline.exec();
  const members = (results?.[0]?.[1] as string[] | undefined) ?? [];
  return members
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}
