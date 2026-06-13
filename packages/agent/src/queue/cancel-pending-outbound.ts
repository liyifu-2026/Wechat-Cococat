import { getOutboundQueue } from "./queues.js";
import type { OutboundJobData } from "./queues.js";
import { isQueueEnabled } from "./redis.js";

/** 用户发消息时应取消的延迟/排期 outbound（不含 inbound_thoughtful_reply）。 */
const CANCELLABLE_KINDS = new Set<OutboundJobData["kind"]>([
  "send_text",
  "run_agent_turn",
  "thoughtful_turn",
]);

/**
 * 用户在本 chat 有新活动时，取消尚未执行的延迟 outbound（如「10 分钟后提醒」）。
 */
export async function cancelPendingOutboundForChat(
  chatId: string,
): Promise<number> {
  if (!isQueueEnabled()) return 0;

  const queue = getOutboundQueue();
  let removed = 0;

  for (const state of ["delayed", "waiting"] as const) {
    const jobs = await queue.getJobs([state], 0, 200, false);
    for (const job of jobs) {
      const data = job.data as OutboundJobData;
      if (data.chatId !== chatId) continue;
      if (!CANCELLABLE_KINDS.has(data.kind)) continue;
      try {
        await job.remove();
        removed += 1;
      } catch {
        // job may have started between getJobs and remove
      }
    }
  }

  if (removed > 0) {
    console.log(
      `[pi-wechat] ${chatId}: cancelled ${removed} pending outbound job(s) (user activity)`,
    );
  }

  return removed;
}
