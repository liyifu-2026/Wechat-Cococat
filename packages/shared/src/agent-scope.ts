import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const AGENT_SCOPE_VERSION = 1;
export const MAX_PURPOSE_CHARS = 200;
export const MAX_TAGS = 30;
export const MAX_PATH_HINTS = 15;

export type AgentScopePayload = {
  version: number;
  updatedAt: string;
  indexHash: string;
  purpose: string;
  tags: string[];
  pathHints: string[];
  source: "ingest-rules" | "cli-refresh";
};

const DEFAULT_PURPOSE = "企业知识库文档";
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const FRONTMATTER_RE = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;

function stripFrontmatterBody(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}

function stripMarkdownNoise(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line.trim());
}

export function extractPurposeFromOverview(overview: string): string | null {
  const body = stripFrontmatterBody(overview);
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !isMarkdownHeading(line))
        .map(stripMarkdownNoise)
        .filter((line) => line.length > 0 && !line.startsWith("<!--"))
        .join(" ")
        .trim(),
    )
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return null;
  return paragraphs.slice(0, 2).join(" ").slice(0, MAX_PURPOSE_CHARS);
}

export function extractPurposeFromPurposeMd(raw: string): string | null {
  const text = raw
    .split("\n")
    .map(stripMarkdownNoise)
    .filter((line) => line.length > 0 && !line.startsWith("<!--"))
    .join(" ")
    .trim();
  if (!text || text.includes("What are you trying to understand")) {
    return null;
  }
  return text.slice(0, MAX_PURPOSE_CHARS);
}

function tagFromSlug(slug: string): string {
  const base = slug.split("/").pop()?.trim() || slug.trim();
  if (!base) return "";
  if (/[\u4e00-\u9fff]/.test(base)) return base;
  return base.replace(/-/g, " ").trim();
}

function tagsFromDescription(line: string): string[] {
  const desc = line.match(/\]\]\s*[—–-]\s*(.+)$/)?.[1]?.trim();
  if (!desc || desc.length < 2 || desc.length > 40) return [];
  return [desc];
}

export function extractTagsAndPathHints(indexContent: string): {
  tags: string[];
  pathHints: string[];
} {
  const tags: string[] = [];
  const pathHints: string[] = [];

  for (const line of indexContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(trimmed)) !== null) {
      const slug = match[1]?.trim();
      if (!slug || slug === "index" || slug === "overview") continue;
      pathHints.push(`wiki/${slug}`);
      const fromSlug = tagFromSlug(slug);
      if (fromSlug) tags.push(fromSlug);
    }

    tags.push(...tagsFromDescription(trimmed));
  }

  const uniqueTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(
    0,
    MAX_TAGS,
  );
  const uniqueHints = [...new Set(pathHints)].slice(0, MAX_PATH_HINTS);

  return { tags: uniqueTags, pathHints: uniqueHints };
}

export function buildAgentScopePayload(input: {
  overview?: string;
  purposeMd?: string;
  indexContent: string;
  now?: Date;
  source?: AgentScopePayload["source"];
}): AgentScopePayload {
  const purpose =
    (input.overview ? extractPurposeFromOverview(input.overview) : null) ??
    (input.purposeMd ? extractPurposeFromPurposeMd(input.purposeMd) : null) ??
    DEFAULT_PURPOSE;

  const { tags, pathHints } = extractTagsAndPathHints(input.indexContent);
  const indexHash = bytesToHex(
    sha256(utf8ToBytes(`${input.indexContent}\n${purpose}`)),
  );

  return {
    version: AGENT_SCOPE_VERSION,
    updatedAt: (input.now ?? new Date()).toISOString(),
    indexHash,
    purpose,
    tags,
    pathHints,
    source: input.source ?? "ingest-rules",
  };
}
