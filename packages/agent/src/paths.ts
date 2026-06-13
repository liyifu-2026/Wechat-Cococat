import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  encodeChatDir,
  getCococatConfigDir,
  getCococatDataRoot,
} from "@cococat/shared";

export { encodeChatDir };

export const CONFIG_DIR = getCococatConfigDir();
export const DATA_DIR = getCococatDataRoot();

export const STACK_DIR = join(DATA_DIR, "stack");

export function configPath(filename: string): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  return join(CONFIG_DIR, filename);
}

export function resolveConfigPath(filename: string): string {
  const primary = join(CONFIG_DIR, filename);
  if (existsSync(primary)) return primary;
  return primary;
}

export function chatsRootDir(): string {
  return join(DATA_DIR, "chats");
}

export function ensureChatsRoot(): string {
  const dir = join(DATA_DIR, "chats");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryDataDir(): string {
  const dir = join(DATA_DIR, "memory");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-chat dir under canonical data root. */
export function chatDirPath(chatId: string): string {
  return join(DATA_DIR, "chats", encodeChatDir(chatId));
}

export const GLOBAL_PERSONA_PATH = resolveConfigPath("persona.md");
export const WIKI_REGISTRY_PATH = resolveConfigPath("wiki-registry.json");
export const WIKI_DEFAULT_PATH = resolveConfigPath("wiki-default.json");

/** @deprecated use memoryDataDir() */
export const TENCENTDB_DATA_DIR = memoryDataDir();

/** @deprecated use chatsRootDir() */
export const CHATS_DIR = chatsRootDir();
