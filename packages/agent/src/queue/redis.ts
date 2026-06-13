import { Redis, type RedisOptions } from "ioredis";

let sharedConnection: Redis | undefined;

export function redisUrlFromEnv(): string {
  return process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
}

/** BullMQ 连接（避免与 bundled ioredis 实例类型冲突）。 */
export function bullmqConnection(): RedisOptions {
  const raw = redisUrlFromEnv();
  try {
    const url = new URL(raw);
    const opts: RedisOptions = {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port || 6379),
      maxRetriesPerRequest: null,
    };
    if (url.password) opts.password = url.password;
    return opts;
  } catch {
    return {
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

export function isQueueEnabled(): boolean {
  const flag = process.env.QUEUE_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new Redis(redisUrlFromEnv(), {
      maxRetriesPerRequest: null,
    });
  }
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = undefined;
  }
}
