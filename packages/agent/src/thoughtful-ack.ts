import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WeChatClient } from "@cococat/shared";
import { appendAgentTrace } from "./agent-trace.js";
import { chatDirPath } from "./paths.js";
import { isServicePersona, type ChatStyle } from "./style.js";
import {
  resolveThoughtfulAckPhrases,
  resolveThoughtfulAckFlag,
  resolveThoughtfulAckDelayMs,
} from "./effective-config.js";

const DEFAULT_SERVICE_ACK_PHRASES = [
  "稍等",
  "请等一下",
  "我帮您看一下",
  "我查下",
  "稍等哈",
] as const;

const AVOID_RECENT = 3;
const DEFAULT_DELAY_MS = 15_000;

type AckHistory = {
  recent: string[];
};

function ackHistoryPath(chatId: string): string {
  return join(chatDirPath(chatId), "thoughtful-ack.json");
}

function loadAckHistory(chatId: string): AckHistory {
  const path = ackHistoryPath(chatId);
  if (!existsSync(path)) return { recent: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { recent?: unknown };
    if (Array.isArray(raw.recent)) {
      return {
        recent: raw.recent.filter((p): p is string => typeof p === "string"),
      };
    }
  } catch (err) {
    console.warn(
      `[pi-wechat] failed to load thoughtful ack history for ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return { recent: [] };
}

function saveAckHistory(chatId: string, history: AckHistory): void {
  const path = ackHistoryPath(chatId);
  const dir = chatDirPath(chatId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(history, null, 0), "utf8");
}

export function resolveAckPhrasePool(style: ChatStyle): string[] {
  const envParts = resolveThoughtfulAckPhrases();
  if (envParts) return envParts;
  if (Array.isArray(style.thoughtfulAckPhrases) && style.thoughtfulAckPhrases.length > 0) {
    return style.thoughtfulAckPhrases;
  }
  if (typeof style.thoughtfulAck === "string" && style.thoughtfulAck.trim()) {
    return [style.thoughtfulAck.trim()];
  }
  return [...DEFAULT_SERVICE_ACK_PHRASES];
}

/** 从池中选择 ack，排除本 chat 最近 N 条。 */
export function pickThoughtfulAckPhrase(chatId: string, style: ChatStyle): string | undefined {
  if (!shouldUseDelayedThoughtfulAck(style)) return undefined;

  const pool = resolveAckPhrasePool(style);
  if (pool.length === 0) return undefined;

  const history = loadAckHistory(chatId);
  const blocked = new Set(history.recent.slice(-AVOID_RECENT));
  const candidates = pool.filter((p) => !blocked.has(p));
  const pick = (candidates.length > 0 ? candidates : pool)[
    Math.floor(Math.random() * (candidates.length > 0 ? candidates.length : pool.length))
  ]!;
  return pick;
}

export function recordThoughtfulAckSent(chatId: string, phrase: string): void {
  const history = loadAckHistory(chatId);
  history.recent = [...history.recent, phrase].slice(-10);
  saveAckHistory(chatId, history);
}

export function shouldUseDelayedThoughtfulAck(style: ChatStyle): boolean {
  const flag = resolveThoughtfulAckFlag();
  if (flag === false) return false;

  if (isServicePersona(style)) {
    if (style.thoughtfulAck === false) return false;
    return true;
  }

  if (flag === true) return true;
  if (style.thoughtfulAck === true) return true;
  if (typeof style.thoughtfulAck === "string" && style.thoughtfulAck.trim()) {
    return true;
  }
  return false;
}

export function thoughtfulAckDelayMs(): number {
  return resolveThoughtfulAckDelayMs();
}

export type DelayedAckHandle = {
  cancel: () => void;
  /** 若已发送 ack，返回文案 */
  getAckLine: () => string | undefined;
};

/** 15s 内无 outbound send 则发轮换 ack（客服私聊默认）。 */
export function startDelayedThoughtfulAck(params: {
  client: WeChatClient;
  chatId: string;
  chatName?: string;
  style: ChatStyle;
  sendCountRef: { current: number };
  ackLineRef: { current: string | undefined };
}): DelayedAckHandle {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const delayMs = thoughtfulAckDelayMs();

  timer = setTimeout(() => {
    void (async () => {
      if (cancelled || params.sendCountRef.current > 0) return;

      const text = pickThoughtfulAckPhrase(params.chatId, params.style);
      if (!text) return;

      await params.client.sendMessage({ chatId: params.chatId, text });
      recordThoughtfulAckSent(params.chatId, text);
      params.ackLineRef.current = text;

      console.log(
        `[pi-wechat] thoughtful delayed ack → ${params.chatId}: ${text}`,
      );
      appendAgentTrace({
        chatId: params.chatId,
        chatName: params.chatName,
        phase: "ack",
        detail: text,
        query: "thoughtful_delayed_ack",
      });
    })().catch((err) => {
      console.warn("[pi-wechat] thoughtful delayed ack failed:", err);
    });
  }, delayMs);

  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
    getAckLine: () => params.ackLineRef.current,
  };
}
