import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WeChatClient } from "@cococat/shared";
import { encodeChatDir, getCococatDataRoot } from "@cococat/shared";
import { ensureChatContext, updateChatMeta } from "./chat-store.js";
import { clearCaptionDirty } from "./caption-dirty.js";
import {
  dbMessagesToTranscript,
  saveTranscript,
} from "./transcript.js";

function chatIdFromEncodedDir(name: string): string | undefined {
  if (!name.startsWith("_")) return undefined;
  const inner = name.slice(1);
  const idx = inner.lastIndexOf("_chatroom");
  if (idx >= 0 && inner.endsWith("_chatroom")) {
    return `${inner.slice(0, idx)}@chatroom`;
  }
  return inner;
}

export function listKnownChatIds(): string[] {
  const root = join(getCococatDataRoot(), "chats");
  if (!existsSync(root)) return [];
  const ids: string[] = [];
  for (const name of readdirSync(root)) {
    const metaPath = join(root, name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
        chatId?: string;
      };
      if (meta.chatId) {
        ids.push(meta.chatId);
        continue;
      }
    } catch {
      // fall through
    }
    const decoded = chatIdFromEncodedDir(name);
    if (decoded) ids.push(decoded);
  }
  return ids;
}

export async function reconcileTranscriptForChat(
  client: WeChatClient,
  chatId: string,
  historyLimit = 50,
): Promise<{ entryCount: number }> {
  const ctx = ensureChatContext(chatId);
  const isGroup = chatId.includes("@chatroom");
  const limit = ctx.style.historyLimit ?? historyLimit;

  const messages = await client.listMessages(chatId, limit);
  const entries = dbMessagesToTranscript(
    messages,
    isGroup,
    ctx.captionsDir,
    limit,
  );

  saveTranscript(ctx.transcriptPath, entries);
  clearCaptionDirty(chatId);

  const maxLocalId = messages.reduce(
    (max, m) => (m.localId > max ? m.localId : max),
    0,
  );
  if (maxLocalId > 0) {
    updateChatMeta(ctx, { lastLocalId: maxLocalId });
  }

  console.log(
    `[pi-wechat] reconcile ${chatId} (${encodeChatDir(chatId)}): ${entries.length} entries`,
  );
  return { entryCount: entries.length };
}

export async function reconcileAllTranscripts(
  client: WeChatClient,
  historyLimit = 50,
): Promise<void> {
  const chatIds = listKnownChatIds();
  if (chatIds.length === 0) {
    console.log("[pi-wechat] reconcile: no chat directories found");
    return;
  }
  for (const chatId of chatIds) {
    try {
      await reconcileTranscriptForChat(client, chatId, historyLimit);
    } catch (err) {
      console.error(
        `[pi-wechat] reconcile ${chatId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
