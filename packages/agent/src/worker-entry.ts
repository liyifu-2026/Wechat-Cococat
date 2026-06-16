/**
 * Long-lived Agent Worker — stdin/stdout JSON-RPC (one JSON object per line).
 * stdout is reserved for RPC responses only; all logs go to stderr.
 */
import { createInterface } from "node:readline";
import { previewCustomerReply } from "./preview-reply.js";

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function writeRpc(line: string): void {
  originalStdoutWrite(line.endsWith("\n") ? line : `${line}\n`);
}

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

console.log = (...args: unknown[]) => {
  logStderr(args.map(String).join(" "));
};
console.info = console.log;
console.warn = (...args: unknown[]) => {
  logStderr(`[WARN] ${args.map(String).join(" ")}`);
};
console.error = (...args: unknown[]) => {
  logStderr(`[ERROR] ${args.map(String).join(" ")}`);
};

process.stdin.on("close", () => {
  logStderr("[Worker] stdin closed — exiting");
  process.exit(0);
});

type RpcRequest = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

type RpcResponse = {
  id: number | null;
  result?: unknown;
  error?: string | null;
};

function toPreviewParams(params: Record<string, unknown> | undefined): {
  query: string;
  chatId?: string;
} {
  const query = typeof params?.query === "string" ? params.query.trim() : "";
  if (!query) {
    throw new Error("preview_reply requires params.query");
  }
  const chatId =
    typeof params?.chatId === "string" && params.chatId.trim()
      ? params.chatId.trim()
      : undefined;
  return { query, chatId };
}

async function handleMethod(
  method: string,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  if (method === "preview_reply") {
    const { query, chatId } = toPreviewParams(params);
    const result = await previewCustomerReply({ query, chatId });
    return {
      action: result.action,
      gate: result.gate,
      executedAction: result.executedAction,
      reason: result.reason,
      answer: result.answer,
      stealthOk: result.stealthOk,
      bannedHits: result.bannedHits,
      confidence: result.confidence,
      source: result.source,
    };
  }
  if (method === "ping") {
    return { ok: true };
  }
  throw new Error(`Unknown method: ${method}`);
}

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: RpcRequest;
  try {
    req = JSON.parse(trimmed) as RpcRequest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRpc(JSON.stringify({ id: null, result: null, error: `Invalid JSON: ${message}` }));
    return;
  }

  const id = typeof req.id === "number" ? req.id : null;
  const method = req.method ?? "";

  try {
    const result = await handleMethod(method, req.params);
    const res: RpcResponse = { id, result, error: null };
    writeRpc(JSON.stringify(res));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRpc(JSON.stringify({ id, result: null, error: message }));
  }
}

function runWorkerLoop(): void {
  logStderr("[Worker] Agent RPC worker ready");
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    void handleLine(line);
  });
  rl.on("close", () => {
    process.exit(0);
  });
}

if (process.argv.includes("--worker")) {
  runWorkerLoop();
}
