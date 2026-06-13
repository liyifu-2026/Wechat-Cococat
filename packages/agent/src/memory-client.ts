import { writePersonaMemorySection } from "./persona.js";

export type MemoryCaptureTurn = {
  userLines: string[];
  assistantLines: string[];
};

type RecallResponse = {
  context?: string;
  strategy?: string;
  memory_count?: number;
};

type CaptureResponse = {
  l0_recorded?: number;
  scheduler_notified?: boolean;
};

type ConversationSearchResponse = {
  results?: string;
  total?: number;
};

export type MemoryClientOptions = {
  gatewayUrl: string;
  apiKey?: string;
  recallTimeoutMs: number;
};

export class MemoryClient {
  constructor(private opts: MemoryClientOptions) {}

  get url(): string {
    return this.opts.gatewayUrl;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) {
      h.Authorization = `Bearer ${this.opts.apiKey}`;
    }
    return h;
  }

  private async post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    const controller = new AbortController();
    const timer =
      timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;
    try {
      const resp = await fetch(`${this.opts.gatewayUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      return (await resp.json()) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.opts.gatewayUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** recall → system 注入；超时/失败静默返回 undefined。 */
  async recall(sessionKey: string, query: string): Promise<string | undefined> {
    const q = query.trim();
    if (!q) return undefined;
    try {
      const res = await this.post<RecallResponse>(
        "/recall",
        { query: q, session_key: sessionKey },
        this.opts.recallTimeoutMs,
      );
      const ctx = res.context?.trim();
      return ctx || undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pi-wechat] memory recall skipped: ${msg}`);
      return undefined;
    }
  }

  async capture(sessionKey: string, turn: MemoryCaptureTurn): Promise<void> {
    const user = turn.userLines.join("\n").trim();
    const assistant = turn.assistantLines.join("\n").trim();
    if (!user || !assistant) return;

    try {
      await this.post<CaptureResponse>("/capture", {
        session_key: sessionKey,
        user_content: user,
        assistant_content: assistant,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pi-wechat] memory capture failed: ${msg}`);
    }
  }

  /** Sidecar 按 session 拉 L3 摘要；空结果不写 per-chat，避免交叉污染。 */
  private async fetchL3FromSidecar(sessionKey: string): Promise<string> {
    try {
      const search = await this.post<ConversationSearchResponse>(
        "/search/conversations",
        {
          query: "用户偏好 相处 习惯 重要事实",
          limit: 8,
          session_key: sessionKey,
        },
        8000,
      );
      return search.results?.trim() ?? "";
    } catch {
      return "";
    }
  }

  /** L3 / 会话记忆 → 本地 persona.md ## 相处记忆 */
  async syncPersonaL3(sessionKey: string, personaPath: string): Promise<void> {
    const body = await this.fetchL3FromSidecar(sessionKey);
    if (!body) {
      console.warn(
        `[pi-wechat] memory L3 sync skipped for ${sessionKey}: sidecar returned empty`,
      );
      return;
    }
    writePersonaMemorySection(personaPath, body);
  }
}

export function createMemoryClient(): MemoryClient {
  if (process.env.TDAI_MEMORY_ENABLED === "false") {
    throw new Error(
      "TDAI_MEMORY_ENABLED=false is not supported: Memory is required infrastructure for CocoCat Agent",
    );
  }

  const gatewayUrl = (
    process.env.TDAI_GATEWAY_URL?.trim() ?? "http://127.0.0.1:8420"
  ).replace(/\/$/, "");

  const apiKey =
    process.env.TDAI_GATEWAY_API_KEY?.trim() ||
    process.env.MEMORY_TENCENTDB_GATEWAY_API_KEY?.trim() ||
    undefined;

  const recallTimeoutMs = Number(process.env.TDAI_RECALL_TIMEOUT_MS ?? "5000");

  return new MemoryClient({
    gatewayUrl,
    apiKey,
    recallTimeoutMs,
  });
}
