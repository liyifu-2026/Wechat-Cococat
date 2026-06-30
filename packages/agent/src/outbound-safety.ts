import type { SendParams, SendResult, WeChatClient } from "@cococat/shared";

type SendRecord = {
  chatId: string;
  at: number;
};

type SafetyLimits = {
  enabled: boolean;
  perChatWindowMs: number;
  globalWindowMs: number;
  maxPerChatInWindow: number;
  maxGlobalInWindow: number;
  minPerChatIntervalMs: number;
  minGlobalIntervalMs: number;
  maxAutoDelayMs: number;
  cooldownMs: number;
};

const DEFAULT_LIMITS: SafetyLimits = {
  enabled: true,
  perChatWindowMs: 10 * 60 * 1000,
  globalWindowMs: 10 * 60 * 1000,
  maxPerChatInWindow: 0,
  maxGlobalInWindow: 0,
  minPerChatIntervalMs: 3_000,
  minGlobalIntervalMs: 800,
  maxAutoDelayMs: 90_000,
  cooldownMs: 30 * 60 * 1000,
};

let records: SendRecord[] = [];
let cooldownUntil = 0;
let sendQueue: Promise<void> = Promise.resolve();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function loadLimits(): SafetyLimits {
  const enabled = !["0", "false", "off"].includes(
    (process.env.COCOCAT_OUTBOUND_SAFETY ?? "").toLowerCase(),
  );
  return {
    enabled,
    perChatWindowMs: envInt(
      "COCOCAT_OUTBOUND_PER_CHAT_WINDOW_MS",
      DEFAULT_LIMITS.perChatWindowMs,
    ),
    globalWindowMs: envInt(
      "COCOCAT_OUTBOUND_GLOBAL_WINDOW_MS",
      DEFAULT_LIMITS.globalWindowMs,
    ),
    maxPerChatInWindow: envInt(
      "COCOCAT_OUTBOUND_MAX_PER_CHAT",
      DEFAULT_LIMITS.maxPerChatInWindow,
    ),
    maxGlobalInWindow: envInt(
      "COCOCAT_OUTBOUND_MAX_GLOBAL",
      DEFAULT_LIMITS.maxGlobalInWindow,
    ),
    minPerChatIntervalMs: envInt(
      "COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS",
      DEFAULT_LIMITS.minPerChatIntervalMs,
    ),
    minGlobalIntervalMs: envInt(
      "COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS",
      DEFAULT_LIMITS.minGlobalIntervalMs,
    ),
    maxAutoDelayMs: envInt(
      "COCOCAT_OUTBOUND_MAX_AUTO_DELAY_MS",
      DEFAULT_LIMITS.maxAutoDelayMs,
    ),
    cooldownMs: envInt(
      "COCOCAT_OUTBOUND_COOLDOWN_MS",
      DEFAULT_LIMITS.cooldownMs,
    ),
  };
}

function prune(now: number, limits: SafetyLimits): void {
  const maxWindow = Math.max(limits.perChatWindowMs, limits.globalWindowMs);
  records = records.filter((r) => now - r.at <= maxWindow);
}

function block(reason: string): never {
  throw new Error(`[outbound-safety] blocked: ${reason}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredDelayMs(
  chatId: string,
  now: number,
  limits: SafetyLimits,
): number {
  let waitMs = 0;

  const lastGlobal = records.at(-1);
  if (lastGlobal && limits.minGlobalIntervalMs > 0) {
    waitMs = Math.max(
      waitMs,
      limits.minGlobalIntervalMs - (now - lastGlobal.at),
    );
  }

  const lastChat = [...records].reverse().find((r) => r.chatId === chatId);
  if (lastChat && limits.minPerChatIntervalMs > 0) {
    waitMs = Math.max(
      waitMs,
      limits.minPerChatIntervalMs - (now - lastChat.at),
    );
  }

  return Math.max(0, waitMs);
}

async function waitUntilSafe(
  chatId: string,
  now: number,
  limits: SafetyLimits,
): Promise<void> {
  if (!limits.enabled) return;
  prune(now, limits);

  if (cooldownUntil > now) {
    block(
      `cooldown active for ${Math.ceil((cooldownUntil - now) / 1000)}s`,
    );
  }

  const globalCount = records.filter(
    (r) => now - r.at <= limits.globalWindowMs,
  ).length;
  if (
    limits.maxGlobalInWindow > 0 &&
    globalCount >= limits.maxGlobalInWindow
  ) {
    block("global send budget exhausted");
  }

  const chatCount = records.filter(
    (r) => r.chatId === chatId && now - r.at <= limits.perChatWindowMs,
  ).length;
  if (
    limits.maxPerChatInWindow > 0 &&
    chatCount >= limits.maxPerChatInWindow
  ) {
    block("per-chat send budget exhausted");
  }

  const delayMs = requiredDelayMs(chatId, now, limits);
  if (delayMs <= 0) return;
  if (delayMs > limits.maxAutoDelayMs) {
    block(`required delay ${delayMs}ms exceeds max auto delay`);
  }
  await sleep(delayMs);
}

function recordSend(chatId: string, now: number, limits: SafetyLimits): void {
  if (!limits.enabled) return;
  records.push({ chatId, at: now });
  prune(now, limits);
}

async function sendWeChatSafelyImpl(
  client: WeChatClient,
  params: SendParams,
): Promise<SendResult> {
  const limits = loadLimits();
  await waitUntilSafe(params.chatId, Date.now(), limits);

  const result = await client.sendMessage(params);
  if (!result.success) {
    const error = result.error ?? "unknown send failure";
    if (/cooldown|频繁|警告|限制|封|异常|risk|rate/i.test(error)) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + limits.cooldownMs);
    }
    throw new Error(`[wechat-send] ${error}`);
  }

  recordSend(params.chatId, Date.now(), limits);
  return result;
}

export function sendWeChatSafely(
  client: WeChatClient,
  params: SendParams,
): Promise<SendResult> {
  const run = sendQueue.then(
    () => sendWeChatSafelyImpl(client, params),
    () => sendWeChatSafelyImpl(client, params),
  );
  sendQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetOutboundSafetyForTest(): void {
  records = [];
  cooldownUntil = 0;
  sendQueue = Promise.resolve();
}
