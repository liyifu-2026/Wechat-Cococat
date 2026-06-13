import { writeFileSync } from "node:fs";
import type { ChatContext, ChatWikiConfig } from "./chat-store.js";
import type { WikiClient } from "./wiki-client.js";

export function saveChatWikiConfig(
  ctx: ChatContext,
  wiki: ChatWikiConfig,
): void {
  ctx.wiki = wiki;
  writeFileSync(ctx.wikiPath, `${JSON.stringify(wiki, null, 2)}\n`, "utf8");
}

/** 私聊/chat 尚未绑库时，从 Console 自动选当前或唯一 Wiki 项目。 */
export async function ensureChatWikiAutoBound(
  chatCtx: ChatContext,
  wikiClient: WikiClient,
): Promise<boolean> {
  if (chatCtx.wiki.projects.length > 0) return false;

  await wikiClient.syncRegistry();
  const aliases = wikiClient.pickDefaultAliases();
  if (aliases.length === 0) {
    console.warn(
      `[pi-wechat] wiki auto-bind skipped for ${chatCtx.chatId}: Console 未发现可用 Wiki 项目`,
    );
    return false;
  }

  saveChatWikiConfig(chatCtx, { projects: aliases });
  wikiClient.setProjectAliases(aliases);
  console.log(
    `[pi-wechat] wiki auto-bound ${chatCtx.chatId} → [${aliases.join(", ")}]`,
  );
  return true;
}
