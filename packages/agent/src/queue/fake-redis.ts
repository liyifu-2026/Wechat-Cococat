import type { Redis } from "ioredis";

/** 单元测试用内存 Redis（仅实现 pending SET + MULTI drain）。 */
export class FakeRedis {
  private readonly sets = new Map<string, Set<string>>();

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) added += 1;
      set.add(m);
    }
    this.sets.set(key, set);
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  multi() {
    const sets = this.sets;
    let smembersKey = "";
    let delKey = "";
    const pipeline = {
      smembers(key: string) {
        smembersKey = key;
        return pipeline;
      },
      del(key: string) {
        delKey = key;
        return pipeline;
      },
      async exec() {
        const members = [...(sets.get(smembersKey) ?? [])];
        sets.delete(delKey);
        return [
          [null, members],
          [null, 1],
        ] as [Error | null, unknown][];
      },
    };
    return pipeline;
  }
}

export function asRedis(fake: FakeRedis): Redis {
  return fake as unknown as Redis;
}
