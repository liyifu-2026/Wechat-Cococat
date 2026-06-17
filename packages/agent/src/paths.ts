import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  encodeChatDir,
  getCococatConfigDir,
  getCococatDataRoot,
} from "@cococat/shared";

export { encodeChatDir };

/** Resolve on each call so tests can swap COCOCAT_*_DIR at runtime. */
export function dataDir(): string {
  return getCococatDataRoot();
}

export function configDir(): string {
  return getCococatConfigDir();
}

export function stackDir(): string {
  return join(dataDir(), "stack");
}

export function configPath(filename: string): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

export function resolveConfigPath(filename: string): string {
  const primary = join(configDir(), filename);
  if (existsSync(primary)) return primary;
  return primary;
}

export function chatsRootDir(): string {
  return join(dataDir(), "chats");
}

export function ensureChatsRoot(): string {
  const dir = chatsRootDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryDataDir(): string {
  const dir = join(dataDir(), "memory");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-chat dir under canonical data root. */
export function chatDirPath(chatId: string): string {
  return join(dataDir(), "chats", encodeChatDir(chatId));
}

export function globalPersonaPath(): string {
  return resolveConfigPath("persona.md");
}

export function wikiRegistryPath(): string {
  return resolveConfigPath("wiki-registry.json");
}

export function wikiDefaultPath(): string {
  return resolveConfigPath("wiki-default.json");
}

/** @deprecated use memoryDataDir() */
export const TENCENTDB_DATA_DIR = memoryDataDir();

/** @deprecated use chatsRootDir() */
export const CHATS_DIR = chatsRootDir();
