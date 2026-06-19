/**
 * Upstream RPC from Node Worker → Rust (bidirectional stdio).
 * Used when COCOCAT_WIKI_INTERNAL=1 or --worker mode is active.
 */

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

type UpstreamPending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let upstreamIdCounter = 0;
const upstreamPending = new Map<number, UpstreamPending>();

export function isWikiInternalMode(): boolean {
  return (
    process.env.COCOCAT_WIKI_INTERNAL === "1" ||
    process.argv.includes("--worker")
  );
}

function writeUpstreamFrame(line: string): void {
  originalStdoutWrite(line.endsWith("\n") ? line : `${line}\n`);
}

export function handleUpstreamResponseLine(raw: string): boolean {
  let parsed: { id?: number; result?: unknown; error?: string | null };
  try {
    parsed = JSON.parse(raw) as { id?: number; result?: unknown; error?: string | null };
  } catch (err) {
    console.warn(
      "[pi-wechat] wiki upstream response parse failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
  if (typeof parsed.id !== "number") return false;
  const pending = upstreamPending.get(parsed.id);
  if (!pending) return false;
  upstreamPending.delete(parsed.id);
  const err = parsed.error;
  if (typeof err === "string" && err.length > 0) {
    pending.reject(new Error(err));
    return true;
  }
  pending.resolve(parsed.result);
  return true;
}

export function emitRpcToRust<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (!isWikiInternalMode()) {
    return Promise.reject(
      new Error("emitRpcToRust requires COCOCAT_WIKI_INTERNAL or --worker"),
    );
  }
  const id = ++upstreamIdCounter;
  return new Promise<T>((resolve, reject) => {
    upstreamPending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    writeUpstreamFrame(
      JSON.stringify({
        direction: "request",
        id,
        method,
        params,
      }),
    );
  });
}

export type FederatedSearchHit = {
  path: string;
  title: string;
  snippet: string;
  titleMatch: boolean;
  score: number;
  rrfScore: number;
  projectPath: string;
  projectName?: string;
  libraryRank: number;
  rawScore: number;
  relPath: string;
  content?: string;
};

export type ConsoleProjectRow = {
  id: string;
  name: string;
  path: string;
  current: boolean;
};

export async function wikiSearchFederatedInternal(
  projects: Array<{ projectPath: string; projectName?: string }>,
  query: string,
  topK: number,
  includeContent = true,
): Promise<FederatedSearchHit[]> {
  const result = await emitRpcToRust<FederatedSearchHit[]>(
    "wiki_search_federated",
    { projects, query, topK, includeContent },
  );
  return Array.isArray(result) ? result : [];
}

export async function wikiReadFileInternal(
  projectPath: string,
  relPath: string,
): Promise<string> {
  const result = await emitRpcToRust<{ content?: string }>("wiki_read_file", {
    projectPath,
    relPath,
  });
  return typeof result?.content === "string" ? result.content : "(空页面)";
}

export async function wikiListProjectsInternal(): Promise<ConsoleProjectRow[]> {
  const result = await emitRpcToRust<{ projects?: ConsoleProjectRow[] }>(
    "wiki_list_projects",
    {},
  );
  return Array.isArray(result?.projects) ? result.projects : [];
}
