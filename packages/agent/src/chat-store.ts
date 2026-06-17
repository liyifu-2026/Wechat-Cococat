import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forkPersonaTo } from "./persona.js";
import {
  chatDirPath,
  encodeChatDir,
  ensureChatsRoot,
  wikiDefaultPath,
} from "./paths.js";
import { initChatStyle, loadChatStyle, type ChatStyle } from "./style.js";

export type ChatMeta = {
  chatId: string;
  lastLocalId?: number;
  createdAt: string;
};

export type ChatWikiConfig = {
  projects: string[];
};

export type ChatContext = {
  chatId: string;
  dir: string;
  metaPath: string;
  personaPath: string;
  stylePath: string;
  wikiPath: string;
  transcriptPath: string;
  seenPath: string;
  captionsDir: string;
  meta: ChatMeta;
  style: ChatStyle;
  wiki: ChatWikiConfig;
};

function defaultWikiConfig(): ChatWikiConfig {
  const wikiDefault = wikiDefaultPath();
  if (existsSync(wikiDefault)) {
    try {
      const raw = JSON.parse(readFileSync(wikiDefault, "utf8")) as {
        projects?: unknown;
      };
      if (Array.isArray(raw.projects)) {
        return {
          projects: raw.projects.filter((p): p is string => typeof p === "string"),
        };
      }
    } catch {
      // fall through
    }
  }
  const envProject = process.env.WIKI_PROJECT_ID?.trim();
  return envProject ? { projects: [envProject] } : { projects: [] };
}

function initWikiConfig(wikiPath: string): ChatWikiConfig {
  const wiki = defaultWikiConfig();
  writeFileSync(wikiPath, JSON.stringify(wiki, null, 2) + "\n", "utf8");
  return wiki;
}

function loadWikiConfig(wikiPath: string): ChatWikiConfig {
  if (!existsSync(wikiPath)) return initWikiConfig(wikiPath);
  try {
    const raw = JSON.parse(readFileSync(wikiPath, "utf8")) as {
      projects?: unknown;
    };
    if (Array.isArray(raw.projects)) {
      return {
        projects: raw.projects.filter((p): p is string => typeof p === "string"),
      };
    }
  } catch {
    // fall through
  }
  return defaultWikiConfig();
}

/** 首次处理该 chat 时 lazy fork 目录与人设。 */
export function ensureChatContext(chatId: string): ChatContext {
  ensureChatsRoot();

  const dir = chatDirPath(chatId);
  const metaPath = join(dir, "meta.json");
  const personaPath = join(dir, "persona.md");
  const stylePath = join(dir, "style.json");
  const wikiPath = join(dir, "wiki.json");
  const transcriptPath = join(dir, "transcript.json");
  const seenPath = join(dir, "seen.json");
  const captionsDir = join(dir, "memory", "captions");

  const isNew = !existsSync(dir);
  if (isNew) {
    mkdirSync(captionsDir, { recursive: true });
  } else if (!existsSync(captionsDir)) {
    mkdirSync(captionsDir, { recursive: true });
  }

  forkPersonaTo(personaPath);

  let meta: ChatMeta;
  if (!existsSync(metaPath)) {
    meta = {
      chatId,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  } else {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChatMeta;
    if (meta.chatId !== chatId) {
      meta.chatId = chatId;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    }
  }

  const style = existsSync(stylePath)
    ? loadChatStyle(stylePath)
    : initChatStyle(stylePath);
  const wiki = loadWikiConfig(wikiPath);

  return {
    chatId,
    dir,
    metaPath,
    personaPath,
    stylePath,
    wikiPath,
    transcriptPath,
    seenPath,
    captionsDir,
    meta,
    style,
    wiki,
  };
}

export function updateChatMeta(
  ctx: ChatContext,
  patch: Partial<ChatMeta>,
): void {
  ctx.meta = { ...ctx.meta, ...patch };
  writeFileSync(
    ctx.metaPath,
    JSON.stringify(ctx.meta, null, 2) + "\n",
    "utf8",
  );
}

export { encodeChatDir };
