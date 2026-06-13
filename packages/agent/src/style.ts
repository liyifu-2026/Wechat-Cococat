import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type GroupMode = "bot" | "member";

export type PersonaMode = "service" | "friend";

export type ReplyMode = "fast" | "thoughtful";

export type DelayRange = number | [number, number] | null;

export type ChatStyle = {
  /** 缺省 service（客服）；friend 保持旧行为。 */
  personaMode?: PersonaMode;
  groupMode: GroupMode;
  replyDelayMs: DelayRange;
  burstDelayMs: DelayRange;
  historyLimit?: number;
  replyCooldownMs?: number;
  maxSendsPerTurn?: number;
  replyMode?: ReplyMode;
  thoughtfulAck?: boolean | string;
  /** 客服 thoughtful 延迟 ack 短语池 */
  thoughtfulAckPhrases?: string[];
  thoughtfulReflect?: boolean;
};

const SERVICE_STYLE_DEFAULTS: Pick<
  ChatStyle,
  "replyDelayMs" | "replyCooldownMs" | "maxSendsPerTurn"
> = {
  replyDelayMs: [800, 2000],
  replyCooldownMs: 0,
  maxSendsPerTurn: 3,
};

const LEGACY_STYLE_DEFAULTS: ChatStyle = {
  groupMode: "bot",
  replyDelayMs: null,
  burstDelayMs: [400, 900],
  replyCooldownMs: 30_000,
  maxSendsPerTurn: 1,
};

export function isServicePersona(style: ChatStyle): boolean {
  return (style.personaMode ?? "service") === "service";
}

/** service 模式应用客服默认节奏；friend 保留 per-chat / legacy 默认。 */
export function resolveEffectiveStyle(style: ChatStyle): ChatStyle {
  if (!isServicePersona(style)) {
    return style;
  }
  return {
    ...style,
    replyDelayMs: style.replyDelayMs ?? SERVICE_STYLE_DEFAULTS.replyDelayMs,
    replyCooldownMs:
      style.replyCooldownMs ?? SERVICE_STYLE_DEFAULTS.replyCooldownMs,
    maxSendsPerTurn:
      style.maxSendsPerTurn ?? SERVICE_STYLE_DEFAULTS.maxSendsPerTurn,
  };
}

function parseDelay(value: unknown): DelayRange {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (Array.isArray(value) && value.length >= 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return [a, b];
  }
  return null;
}

function parsePersonaMode(value: unknown): PersonaMode | undefined {
  if (value === "service" || value === "friend") return value;
  return undefined;
}

export function loadChatStyle(stylePath: string): ChatStyle {
  if (!existsSync(stylePath)) {
    return resolveEffectiveStyle({
      personaMode: "service",
      ...LEGACY_STYLE_DEFAULTS,
    });
  }
  try {
    const raw = JSON.parse(readFileSync(stylePath, "utf8")) as Record<
      string,
      unknown
    >;
    const loaded: ChatStyle = {
      personaMode: parsePersonaMode(raw.personaMode) ?? "service",
      groupMode: raw.groupMode === "member" ? "member" : "bot",
      replyDelayMs: parseDelay(raw.replyDelayMs),
      burstDelayMs:
        parseDelay(raw.burstDelayMs) ?? LEGACY_STYLE_DEFAULTS.burstDelayMs,
      historyLimit:
        typeof raw.historyLimit === "number" ? raw.historyLimit : undefined,
      replyCooldownMs:
        typeof raw.replyCooldownMs === "number"
          ? raw.replyCooldownMs
          : undefined,
      maxSendsPerTurn:
        typeof raw.maxSendsPerTurn === "number"
          ? Math.min(5, Math.max(1, raw.maxSendsPerTurn))
          : undefined,
      replyMode:
        raw.replyMode === "thoughtful" || raw.replyMode === "fast"
          ? raw.replyMode
          : undefined,
      thoughtfulAck:
        raw.thoughtfulAck === true
          ? true
          : typeof raw.thoughtfulAck === "string"
            ? raw.thoughtfulAck
            : raw.thoughtfulAck === false
              ? false
              : undefined,
      thoughtfulAckPhrases: Array.isArray(raw.thoughtfulAckPhrases)
        ? raw.thoughtfulAckPhrases.filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          )
        : undefined,
      thoughtfulReflect:
        raw.thoughtfulReflect === true
          ? true
          : raw.thoughtfulReflect === false
            ? false
            : undefined,
    };
    return resolveEffectiveStyle(loaded);
  } catch {
    return resolveEffectiveStyle({
      personaMode: "service",
      ...LEGACY_STYLE_DEFAULTS,
    });
  }
}

export function initChatStyle(stylePath: string): ChatStyle {
  const style = resolveEffectiveStyle({
    personaMode: "service",
    groupMode: "bot",
    replyDelayMs: SERVICE_STYLE_DEFAULTS.replyDelayMs,
    burstDelayMs: [400, 900],
    replyCooldownMs: SERVICE_STYLE_DEFAULTS.replyCooldownMs,
    maxSendsPerTurn: SERVICE_STYLE_DEFAULTS.maxSendsPerTurn,
    thoughtfulAck: true,
  });
  const globalBurst = process.env.WECHAT_PI_BURST_DELAY_MS;
  if (globalBurst) {
    const n = Number(globalBurst);
    if (!Number.isNaN(n)) style.burstDelayMs = n;
  }
  writeFileSync(stylePath, JSON.stringify(style, null, 2) + "\n", "utf8");
  return style;
}
