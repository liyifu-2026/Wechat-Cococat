import type { Job } from "bullmq";
import type { WeChatClient } from "@cococat/shared";
import type { SessionManager } from "../session.js";
import type { OutboundJobData } from "../queue/queues.js";
import { ensureThoughtfulOutboundJob } from "../queue/enqueue-thoughtful.js";
import {
  filterUnseenLocalIds,
  markSeenLocalIds,
  snapshotAlreadyAnswered,
} from "../queue/snapshot-guard.js";
import { drainThoughtfulPendingLocalIds } from "../queue/thoughtful-pending.js";
import { getRedisConnection } from "../queue/redis.js";
import { loadSchedulesFile } from "./registry.js";
import {
  isOutboundChatAllowed,
  isQuietHoursNow,
} from "./quiet-hours.js";
import { sendWeChatSafely } from "../outbound-safety.js";

export async function handleOutboundJob(
  client: WeChatClient,
  manager: SessionManager,
  job: Job<OutboundJobData>,
): Promise<void> {
  const { chatId, kind, text, systemPrompt, chatName, isGroup, replyMentions } =
    job.data;
  const schedules = loadSchedulesFile();

  const isInboundThoughtful = kind === "inbound_thoughtful_reply";

  if (!isInboundThoughtful) {
    if (!isOutboundChatAllowed(chatId, schedules.allowlistChatIds)) {
      job.log("chat not in outbound allowlist");
      return;
    }

    if (isQuietHoursNow(schedules.quietHours)) {
      job.log("skipped: quiet hours");
      return;
    }
  }

  if (kind === "send_text" && text) {
    await sendWeChatSafely(client, { chatId, text });
    return;
  }

  if (kind === "inbound_thoughtful_reply") {
    const redis = getRedisConnection();
    let userLocalIds = await drainThoughtfulPendingLocalIds(redis, chatId);
    if (userLocalIds.length === 0 && job.data.userLocalIds?.length) {
      userLocalIds = [...job.data.userLocalIds];
    }
    userLocalIds = filterUnseenLocalIds(chatId, userLocalIds);
    if (userLocalIds.length === 0) {
      job.log("empty thoughtful snapshot");
      await ensureThoughtfulOutboundJob({
        chatId,
        chatName: chatName ?? chatId,
        isGroup: isGroup ?? chatId.includes("@chatroom"),
        userLocalIds: [],
        replyMentions,
      });
      return;
    }

    if (await snapshotAlreadyAnswered(client, chatId, userLocalIds)) {
      markSeenLocalIds(chatId, userLocalIds);
      job.log("thoughtful already answered; marked seen");
      await ensureThoughtfulOutboundJob({
        chatId,
        chatName: chatName ?? chatId,
        isGroup: isGroup ?? chatId.includes("@chatroom"),
        userLocalIds: [],
        replyMentions,
      });
      return;
    }

    const session = manager.get(chatId);
    await session.runInboundThoughtfulReply({
      chatName: chatName ?? chatId,
      isGroup: isGroup ?? chatId.includes("@chatroom"),
      userLocalIds,
      replyMentions,
    });

    await ensureThoughtfulOutboundJob({
      chatId,
      chatName: chatName ?? chatId,
      isGroup: isGroup ?? chatId.includes("@chatroom"),
      userLocalIds: [],
      replyMentions,
    });
    return;
  }

  if (kind === "run_agent_turn" || kind === "thoughtful_turn") {
    const session = manager.get(chatId);
    await session.runProactiveTurn({
      chatName: chatName ?? chatId,
      isGroup: isGroup ?? chatId.includes("@chatroom"),
      systemPrompt,
      thoughtful: kind === "thoughtful_turn",
    });
    return;
  }

  job.log(`unknown outbound kind: ${kind}`);
}
