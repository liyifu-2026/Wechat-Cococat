import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** M2 迁移残留：全局 seen.json（一次性 per-chat 迁移） */
const LEGACY_SEEN_PATH = join(homedir(), ".config", "agent-wechat", "seen.json");

export class SeenStore {
  private seen = new Set<string>();
  private readonly path: string;
  private readonly chatId: string;

  constructor(seenPath: string, chatId: string) {
    this.path = seenPath;
    this.chatId = chatId;
    this.migrateLegacy();
    this.load();
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  /** 从磁盘重载（worker markSeenLocalIds 后 Session 内存需对齐）。 */
  reload(): void {
    this.seen.clear();
    this.load();
  }

  add(key: string): void {
    this.seen.add(key);
  }

  persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.path, JSON.stringify([...this.seen], null, 0));
  }

  private migrateLegacy(): void {
    if (existsSync(this.path) || !existsSync(LEGACY_SEEN_PATH)) return;
    try {
      const raw = JSON.parse(readFileSync(LEGACY_SEEN_PATH, "utf8")) as unknown;
      if (!Array.isArray(raw)) return;
      const prefix = `${this.chatId}:`;
      const migrated: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") continue;
        if (item.startsWith(prefix)) {
          migrated.push(item.slice(prefix.length));
        }
      }
      if (migrated.length === 0) return;
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.path, JSON.stringify(migrated, null, 0));
      console.log(
        `[pi-wechat] migrated ${migrated.length} seen entries for ${this.chatId}`,
      );
    } catch {
      // ignore
    }
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string") this.seen.add(item);
        }
      }
    } catch {
      // ignore corrupt file
    }
  }
}
