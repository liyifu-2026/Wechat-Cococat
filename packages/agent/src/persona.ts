import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GLOBAL_PERSONA_PATH } from "./paths.js";

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

function extractSection(content: string, header: string): string {
  const idx = content.indexOf(header);
  if (idx < 0) return "";
  const rest = content.slice(idx + header.length);
  const next = rest.search(/^## /m);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  return body.trim();
}

function wrapAsForkedPersona(globalContent: string): string {
  const trimmed = globalContent.trim();
  if (!trimmed) return defaultPersonaTemplate();

  if (trimmed.includes(CORE_HEADER)) {
    const core = extractSection(trimmed, CORE_HEADER);
    const memory = extractSection(trimmed, MEMORY_HEADER);
    return `${CORE_HEADER}\n\n${core || "（待补充）"}\n\n${MEMORY_HEADER}\n\n${memory}\n`;
  }

  return `${CORE_HEADER}\n\n${trimmed}\n\n${MEMORY_HEADER}\n\n`;
}

export function readGlobalPersonaSeed(): string {
  if (!existsSync(GLOBAL_PERSONA_PATH)) {
    return defaultPersonaTemplate();
  }
  return readFileSync(GLOBAL_PERSONA_PATH, "utf8");
}

export function forkPersonaTo(chatPersonaPath: string): void {
  const dir = chatPersonaPath.replace(/\/persona\.md$/, "");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(chatPersonaPath)) return;

  if (existsSync(GLOBAL_PERSONA_PATH)) {
    writeFileSync(
      chatPersonaPath,
      wrapAsForkedPersona(readFileSync(GLOBAL_PERSONA_PATH, "utf8")),
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
  if (existsSync(GLOBAL_PERSONA_PATH)) {
    return readFileSync(GLOBAL_PERSONA_PATH, "utf8").trim();
  }
  return defaultPersonaTemplate().trim();
}

/** L3 sync：只更新 ## 相处记忆 段。 */
export function writePersonaMemorySection(
  chatPersonaPath: string,
  memoryBody: string,
): void {
  if (!existsSync(chatPersonaPath)) {
    forkPersonaTo(chatPersonaPath);
  }
  const current = readFileSync(chatPersonaPath, "utf8");
  const core = extractSection(current, CORE_HEADER) || "（待补充）";
  const body = memoryBody.trim();
  writeFileSync(
    chatPersonaPath,
    `${CORE_HEADER}\n\n${core}\n\n${MEMORY_HEADER}\n\n${body}\n`,
    "utf8",
  );
}
