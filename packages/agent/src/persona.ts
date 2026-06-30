import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { globalPersonaPath } from "./paths.js";
import { filterMemoryTextForSession } from "./memory-session-filter.js";

const CORE_HEADER = "## 核心性格";
const MEMORY_HEADER = "## 相处记忆";

function defaultPersonaTemplate(): string {
  return `${CORE_HEADER}

你是 CocoCat 品牌官方客服。用「我们」「这边」，不具名、不卖萌。
回答短句、口语化，不用 markdown 列表，不要 AI 腔。
不知道时说「这边帮您确认一下」——内部可查资料，但回复里绝不说知识库、AI、机器人。

${MEMORY_HEADER}

`;
}

/**
 * Wrap global persona content for per-chat fork.
 *
 * If the global content already has the `## 核心性格` header, it's in the
 * correct format — copy as-is. Otherwise (legacy format), wrap it in the
 * default template structure. This deliberately does NOT parse and recombine
 * sections: any future section added between `## 核心性格` and `## 相处记忆`
 * is preserved transparently.
 */
function wrapAsForkedPersona(globalContent: string): string {
  const trimmed = globalContent.trim();
  if (!trimmed) return defaultPersonaTemplate();

  if (trimmed.includes(CORE_HEADER)) {
    return `${trimmed}\n`;
  }

  return `${CORE_HEADER}\n\n${trimmed}\n\n${MEMORY_HEADER}\n\n`;
}

export function readGlobalPersonaSeed(): string {
  if (!existsSync(globalPersonaPath())) {
    return defaultPersonaTemplate();
  }
  return readFileSync(globalPersonaPath(), "utf8");
}

export function forkPersonaTo(chatPersonaPath: string): void {
  const dir = chatPersonaPath.replace(/\/persona\.md$/, "");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(chatPersonaPath)) return;

  if (existsSync(globalPersonaPath())) {
    writeFileSync(
      chatPersonaPath,
      wrapAsForkedPersona(readFileSync(globalPersonaPath(), "utf8")),
      "utf8",
    );
  } else {
    writeFileSync(chatPersonaPath, defaultPersonaTemplate(), "utf8");
  }
}

export function readChatPersona(chatPersonaPath: string): string {
  if (existsSync(chatPersonaPath)) {
    return readFileSync(chatPersonaPath, "utf8").trim();
  }
  if (existsSync(globalPersonaPath())) {
    return readFileSync(globalPersonaPath(), "utf8").trim();
  }
  return defaultPersonaTemplate().trim();
}

export function readChatPersonaForSession(
  chatPersonaPath: string,
  sessionKey: string,
): string {
  const raw = readChatPersona(chatPersonaPath);
  const idx = raw.indexOf(MEMORY_HEADER);
  if (idx < 0) return raw;

  const before = raw.slice(0, idx).trimEnd();
  const memory = raw.slice(idx + MEMORY_HEADER.length).trim();
  const scopedMemory = filterMemoryTextForSession(sessionKey, memory);

  return `${before}\n\n${MEMORY_HEADER}\n\n${scopedMemory ?? ""}`.trim();
}

/**
 * Read the entire persona.md for a chat (Ops peek / debugging).
 *
 * Replaces the old `readPersonaMemorySection` which parsed `## 相处记忆`.
 * The Rust side (`extract_memory_section_body`) is now the sole section
 * parser; the TS side does not parse sections at all.
 */
export function readChatPersonaRaw(chatPersonaPath: string): string {
  if (!existsSync(chatPersonaPath)) return "";
  return readFileSync(chatPersonaPath, "utf8").trim();
}

/**
 * L3 sync: replace the `## 相处记忆` section body in-place.
 *
 * Uses "find marker, replace rest" — locates the `## 相处记忆` marker and
 * replaces everything from that point onward. Everything before the marker
 * (including `## 核心性格` and any future sections) is preserved as-is.
 * This deliberately does NOT parse `## 核心性格`, eliminating the drift
 * risk between the TS and Rust section parsers.
 */
export function writePersonaMemorySection(
  chatPersonaPath: string,
  memoryBody: string,
): void {
  if (!existsSync(chatPersonaPath)) {
    forkPersonaTo(chatPersonaPath);
  }
  const current = readFileSync(chatPersonaPath, "utf8");
  const body = memoryBody.trim();
  const idx = current.indexOf(MEMORY_HEADER);

  if (idx < 0) {
    // No memory section yet — append it.
    writeFileSync(
      chatPersonaPath,
      `${current.trimEnd()}\n\n${MEMORY_HEADER}\n\n${body}\n`,
      "utf8",
    );
    return;
  }

  // Replace from the marker onward; preserve everything before it.
  const before = current.slice(0, idx).trimEnd();
  writeFileSync(
    chatPersonaPath,
    `${before}\n\n${MEMORY_HEADER}\n\n${body}\n`,
    "utf8",
  );
}
