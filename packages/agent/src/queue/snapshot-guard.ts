import type { WeChatClient } from "@cococat/shared";
import { ensureChatContext } from "../chat-store.js";
import { SeenStore } from "../seen.js";

/** Job retry 前：是否已有 bot 消息 localId 晚于本批用户消息（防双发）。 */
export async function snapshotAlreadyAnswered(
  client: WeChatClient,
  chatId: string,
  snapshotLocalIds: number[],
): Promise<boolean> {
  if (snapshotLocalIds.length === 0) return false;
  const maxUserId = Math.max(...snapshotLocalIds);
  const messages = await client.listMessages(chatId, 40);
  return messages.some((m) => m.isSelf && m.localId > maxUserId);
}

export function markSeenLocalIds(chatId: string, localIds: number[]): void {
  if (localIds.length === 0) return;
  const chatCtx = ensureChatContext(chatId);
  const seen = new SeenStore(chatCtx.seenPath, chatId);
  for (const id of localIds) {
    seen.add(String(id));
  }
  seen.persist();
}

/** 去掉已 markSeen 的 localId（pending 竞态 / job 重试防双发）。 */
export function filterUnseenLocalIds(
  chatId: string,
  localIds: number[],
): number[] {
  if (localIds.length === 0) return [];
  const chatCtx = ensureChatContext(chatId);
  const seen = new SeenStore(chatCtx.seenPath, chatId);
  return localIds.filter((id) => !seen.has(String(id)));
}
