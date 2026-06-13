import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { appendConsoleEvent } from "./console-events.js";
import type { WikiClient } from "./wiki-client.js";
import { recordWikiHit } from "./wiki-hit-store.js";

export type WikiToolsContext = {
  chatId: string;
  chatName?: string;
};

function firstHitLabel(searchText: string): string | null {
  const match = searchText.match(/^\[1\]\s+(.+?)\s+\(score:/m);
  return match?.[1]?.trim() ?? null;
}

export function createWikiTools(
  client: WikiClient,
  ctx?: WikiToolsContext,
): AgentTool[] {
  const wikiSearch: AgentTool = {
    name: "wiki_search",
    label: "查资料",
    description: "在知识库里搜相关内容；找到了自然地说，别提 wiki。",
    parameters: Type.Object({
      query: Type.String({ description: "搜索词" }),
      topK: Type.Optional(
        Type.Number({ description: "最多几条，默认 5" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { query, topK } = params as { query: string; topK?: number };
      const text = await client.search(query, Math.min(topK ?? 5, 20));
      if (ctx?.chatId) {
        if (text.includes("没找到")) {
          appendConsoleEvent({
            kind: "no_wiki_hit",
            chatId: ctx.chatId,
            chatName: ctx.chatName,
            query,
            topic: query.slice(0, 48),
          });
        } else {
          const label = firstHitLabel(text);
          if (label) recordWikiHit(ctx.chatId, label);
        }
      }
      return {
        content: [{ type: "text" as const, text }],
        details: { query },
      };
    },
  };

  const wikiReadPage: AgentTool = {
    name: "wiki_read_page",
    label: "读资料页",
    description: "按路径读一整页，例如 工作/wiki/foo.md",
    parameters: Type.Object({
      path: Type.String({
        description: "页面路径，如 工作/wiki/concepts/ml.md",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { path } = params as { path: string };
      const text = await client.readPage(path);
      if (ctx?.chatId) recordWikiHit(ctx.chatId, path);
      return {
        content: [{ type: "text" as const, text }],
        details: { path },
      };
    },
  };

  return [wikiSearch, wikiReadPage];
}
