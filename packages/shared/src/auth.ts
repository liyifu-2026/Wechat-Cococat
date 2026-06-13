import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCococatConfigDir } from "./paths.js";

const LEGACY_TOKEN_PATH = join(homedir(), ".config", "agent-wechat", "token");

export function getAuthTokenPath(): string {
  return join(getCococatConfigDir(), "token");
}

/** Read token from env, cococat path, or legacy path (read-only fallback). */
export function readAuthToken(): string | undefined {
  const env =
    process.env.AGENT_WECHAT_TOKEN?.trim() ||
    process.env.WECHAT_TOKEN?.trim();
  if (env) return env;

  for (const path of [getAuthTokenPath(), LEGACY_TOKEN_PATH]) {
    try {
      const token = readFileSync(path, "utf-8").trim();
      if (token) return token;
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Ensure a token exists under ~/.config/cococat/token (migrate from legacy if needed). */
export function ensureAuthToken(): string {
  const existing = readAuthToken();
  const cococatPath = getAuthTokenPath();
  if (existing) {
    if (!existsSync(cococatPath)) {
      mkdirSync(getCococatConfigDir(), { recursive: true });
      writeFileSync(cococatPath, `${existing}\n`, { mode: 0o600 });
    }
    return existing;
  }

  mkdirSync(getCococatConfigDir(), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(cococatPath, `${token}\n`, { mode: 0o600 });
  return token;
}
