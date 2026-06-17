import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { ensureChatContext } from "./chat-store.js";

export const MAX_PROFILE_TAGS = 5;

const PROFILE_LOCK_TIMEOUT_MS = 3000;
const PROFILE_LOCK_RETRY_MS = 50;

export const DEFAULT_BEHAVIOR_GUIDE =
  "无特殊指南，按常规客服流程接待。";

export type ChatProfileFile = {
  tags: string[];
  userType?: string | null;
};

export function profilePathForChat(chatId: string): string {
  return join(ensureChatContext(chatId).dir, "profile.json");
}

export function parseChatProfileRaw(raw: string): ChatProfileFile {
  if (!raw.trim()) return { tags: [] };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const userType =
      typeof parsed.userType === "string" && parsed.userType.trim()
        ? parsed.userType.trim()
        : parsed.userType === null
          ? null
          : undefined;
    return { tags, userType };
  } catch {
    return { tags: [] };
  }
}

export function loadChatProfile(chatId: string): ChatProfileFile {
  const path = profilePathForChat(chatId);
  if (!existsSync(path)) return { tags: [] };
  return parseChatProfileRaw(readFileSync(path, "utf8"));
}

export function normalizeProfileTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_PROFILE_TAGS) break;
  }
  return out;
}

function serializeProfile(profile: ChatProfileFile): string {
  const payload: Record<string, unknown> = {
    tags: profile.tags,
  };
  if (profile.userType != null && profile.userType.trim()) {
    payload.userType = profile.userType.trim();
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function withProfileLock(
  chatId: string,
  mutate: (profile: ChatProfileFile) => ChatProfileFile,
): Promise<ChatProfileFile> {
  const ctx = ensureChatContext(chatId);
  mkdirSync(ctx.dir, { recursive: true });
  const path = join(ctx.dir, "profile.json");
  if (!existsSync(path)) {
    writeFileSync(path, serializeProfile({ tags: [] }), "utf8");
  }

  const maxRetries = Math.ceil(PROFILE_LOCK_TIMEOUT_MS / PROFILE_LOCK_RETRY_MS);
  const release = await lockfile.lock(path, {
    retries: {
      retries: maxRetries,
      minTimeout: PROFILE_LOCK_RETRY_MS,
      maxTimeout: PROFILE_LOCK_RETRY_MS,
    },
    stale: PROFILE_LOCK_TIMEOUT_MS,
  });

  try {
    const raw = readFileSync(path, "utf8");
    const current = parseChatProfileRaw(raw);
    const next = mutate(current);
    writeFileSync(path, serializeProfile(next), "utf8");
    return next;
  } finally {
    await release();
  }
}

/** Replace tags only; preserves userType. */
export async function patchContactTags(
  chatId: string,
  tags: string[],
): Promise<ChatProfileFile> {
  const cleaned = normalizeProfileTags(tags);
  return withProfileLock(chatId, (profile) => ({
    ...profile,
    tags: cleaned,
  }));
}
