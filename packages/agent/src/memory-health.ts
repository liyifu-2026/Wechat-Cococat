import type { MemoryClient } from "./memory-client.js";

/** Memory sidecar 健康状态；运行中不可用时不 markSeen，等待重试。 */
export class MemoryHealthMonitor {
  private suspended = false;

  constructor(private client: MemoryClient) {}

  get url(): string {
    return this.client.url;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  async assertHealthyAtStartup(): Promise<void> {
    const ok = await this.client.isHealthy();
    if (!ok) {
      throw new Error(
        `[pi-wechat] Memory gateway unreachable at ${this.client.url} — agent refuses to start (Memory is required infrastructure)`,
      );
    }
    this.suspended = false;
  }

  /** 私聊客服入站前调用；false = 暂停自动回复（勿 markSeen）。 */
  async requireAvailable(): Promise<boolean> {
    const ok = await this.client.isHealthy();
    if (ok) {
      if (this.suspended) {
        console.log("[pi-wechat] Memory gateway recovered — resuming service replies");
      }
      this.suspended = false;
      return true;
    }
    if (!this.suspended) {
      console.warn(
        `[pi-wechat] Memory gateway unavailable at ${this.client.url} — suspending private service auto-replies`,
      );
    }
    this.suspended = true;
    return false;
  }
}
