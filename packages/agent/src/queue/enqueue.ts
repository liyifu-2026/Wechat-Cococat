import type { NewMessagesChatInfo, WeChatClient } from "@cococat/shared";
import { ensureChatContext } from "../chat-store.js";
import { SeenStore } from "../seen.js";
import { addPendingLocalIds } from "./pending.js";
import { filterUnseenLocalIds } from "./snapshot-guard.js";
import { getInboundQueue, type InboundJobData } from "./queues.js";
import { getRedisConnection } from "./redis.js";

function messageKey(localId: number): string {
  return String(localId);
}

export async function collectUnseenLocalIds(
  client: WeChatClient,
  chatId: string,
): Promise<number[]> {
  const chatCtx = ensureChatContext(chatId);
  const seen = new SeenStore(chatCtx.seenPath, chatId);
  const messages = await client.listMessages(chatId, 40);
  return messages
    .filter((m) => !m.isSelf && !seen.has(messageKey(m.localId)))
    .map((m) => m.localId);
}

export async function enqueueChatInbound(
  client: WeChatClient,
  chat: NewMessagesChatInfo,
): Promise<void> {
  if (!chat.chatId) return;

  let localIds = await collectUnseenLocalIds(client, chat.chatId);
  if (localIds.length === 0) return;

  // 与 worker markSeen 竞态：入 pending 前再滤一遍已处理 id
  localIds = filterUnseenLocalIds(chat.chatId, localIds);
  if (localIds.length === 0) return;

  const redis = getRedisConnection();
  await addPendingLocalIds(redis, chat.chatId, localIds);

  const queue = getInboundQueue();
  const data: InboundJobData = {
    chatId: chat.chatId,
    chatName: chat.name,
    isGroup: chat.isGroup ?? false,
  };

  try {
    await queue.add("process_chat", data, { jobId: chat.chatId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("job") && !msg.includes("exists")) {
      throw err;
    }
  }
}
