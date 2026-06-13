import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chatDirPath, encodeChatDir } from "./paths.js";

const MAX_HITS = 8;

type WikiHitsFile = {
  hits: string[];
};

function hitsPath(chatId: string): string {
  const dir = chatDirPath(chatId);
  mkdirSync(dir, { recursive: true });
  return `${dir}/wiki-hits.json`;
}

function load(chatId: string): WikiHitsFile {
  const path = hitsPath(chatId);
  if (!existsSync(path)) return { hits: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WikiHitsFile>;
    const hits = Array.isArray(parsed.hits)
      ? parsed.hits.filter((h) => typeof h === "string" && h.trim())
      : [];
    return { hits };
  } catch {
    return { hits: [] };
  }
}

export function recordWikiHit(chatId: string, label: string): void {
  const text = label.trim();
  if (!text || !chatId) return;
  const file = load(chatId);
  const next = [text, ...file.hits.filter((h) => h !== text)].slice(0, MAX_HITS);
  writeFileSync(hitsPath(chatId), `${JSON.stringify({ hits: next }, null, 2)}\n`, "utf8");
}

export function readWikiHits(chatId: string): string[] {
  return load(chatId).hits;
}

export { encodeChatDir };
