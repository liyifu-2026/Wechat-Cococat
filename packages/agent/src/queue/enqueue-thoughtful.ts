import { getOutboundQueue, type OutboundJobData } from "./queues.js";
import { getRedisConnection } from "./redis.js";
import {
  addThoughtfulPendingLocalIds,
  listThoughtfulPendingLocalIds,
} from "./thoughtful-pending.js";

export type EnqueueInboundThoughtfulParams = {
  chatId: string;
  chatName: string;
  isGroup: boolean;
  userLocalIds: number[];
  replyMentions?: string[];
};

function thoughtfulJobId(chatId: string): string {
  return `inbound-thoughtful:${chatId}`;
}

/** 入站 thoughtful 卸载到 outbound 队列（每 chat 至多一个 waiting/active job）。 */
export async function enqueueInboundThoughtfulReply(
  params: EnqueueInboundThoughtfulParams,
): Promise<void> {
  const { chatId, chatName, isGroup, userLocalIds, replyMentions } = params;
  if (userLocalIds.length === 0) return;

  const redis = getRedisConnection();
  await addThoughtfulPendingLocalIds(redis, chatId, userLocalIds);

  const queue = getOutboundQueue();
  const data: OutboundJobData = {
    chatId,
    chatName,
    isGroup,
    kind: "inbound_thoughtful_reply",
    replyMentions,
    userLocalIds,
  };

  try {
    await queue.add("inbound_thoughtful_reply", data, {
      jobId: thoughtfulJobId(chatId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("job") && !msg.includes("exists")) {
      throw err;
    }
  }
}

/** outbound 完成后若 pending 仍有累积，再排一条 job。 */
export async function ensureThoughtfulOutboundJob(
  params: EnqueueInboundThoughtfulParams,
): Promise<void> {
  const redis = getRedisConnection();
  const pending = await listThoughtfulPendingLocalIds(redis, params.chatId);
  const userLocalIds =
    pending.length > 0 ? pending : params.userLocalIds;
  if (userLocalIds.length === 0) return;

  await enqueueInboundThoughtfulReply({ ...params, userLocalIds });
}
