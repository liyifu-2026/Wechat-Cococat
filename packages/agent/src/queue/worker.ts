import { Worker, type Job } from "bullmq";
import type { WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "../config.js";
import type { SessionManager } from "../session.js";
import { drainPendingLocalIds } from "./pending.js";
import { collectUnseenLocalIds } from "./enqueue.js";
import {
  markSeenLocalIds,
  snapshotAlreadyAnswered,
} from "./snapshot-guard.js";
import {
  evaluateInboundFastDiscard,
  logFastDiscard,
} from "./fast-discard.js";
import { cancelPendingOutboundForChat } from "./cancel-pending-outbound.js";
import {
  bullmqConnection,
  getRedisConnection,
  closeRedisConnection,
} from "./redis.js";
import {
  INBOUND_QUEUE,
  OUTBOUND_QUEUE,
  SCHEDULED_QUEUE,
  type InboundJobData,
  type OutboundJobData,
  type ScheduledJobData,
  closeQueues,
} from "./queues.js";
import { handleOutboundJob } from "../schedules/runner.js";

const workers: Worker[] = [];

export async function startQueueWorkers(
  client: WeChatClient,
  config: PiWeChatConfig,
  manager: SessionManager,
): Promise<void> {
  const redis = getRedisConnection();
  const connection = bullmqConnection();
  const concurrency = Number(process.env.QUEUE_CONCURRENCY ?? "4");

  const inbound = new Worker<InboundJobData>(
    INBOUND_QUEUE,
    async (job) => {
      const { chatId, chatName, isGroup } = job.data;
      let snapshot = await drainPendingLocalIds(redis, chatId);

      if (snapshot.length === 0) {
        snapshot = await collectUnseenLocalIds(client, chatId);
      }

      if (snapshot.length === 0) {
        job.log("empty snapshot after drain");
        return;
      }

      await cancelPendingOutboundForChat(chatId);

      if (await snapshotAlreadyAnswered(client, chatId, snapshot)) {
        markSeenLocalIds(chatId, snapshot);
        job.log("already answered; marked seen");
        return;
      }

      if (manager.isMaintainerChat(chatId)) {
        await manager.processMaintainer(chatId);
        return;
      }

      const fastDiscard = await evaluateInboundFastDiscard({
        client,
        group: config.group,
        groupBuffers: manager.getGroupBuffers(),
        escalation: manager.getEscalation(),
        memoryHealth: config.memoryHealth,
        chatId,
        chatName,
        isGroup,
        snapshotLocalIds: snapshot,
      });
  if (fastDiscard) {
    if (fastDiscard.reason === "memory_unavailable") {
      job.log("memory unavailable; will retry without markSeen");
      logFastDiscard(chatName, fastDiscard.reason, chatId);
      return;
    }
    markSeenLocalIds(chatId, fastDiscard.localIds);
    logFastDiscard(chatName, fastDiscard.reason, chatId);
    job.log(`fast-discard: ${fastDiscard.reason}`);
    return;
  }

      await manager
        .get(chatId)
        .processSnapshot(chatName, isGroup, snapshot, {
          replyGuardChecked: true,
        });
    },
    { connection, concurrency },
  );

  const outbound = new Worker<OutboundJobData>(
    OUTBOUND_QUEUE,
    async (job) => {
      await handleOutboundJob(client, manager, job);
    },
    { connection, concurrency: 2 },
  );

  const scheduled = new Worker<ScheduledJobData>(
    SCHEDULED_QUEUE,
    async (job) => {
      await handleOutboundJob(client, manager, {
        ...job,
        data: {
          chatId: job.data.chatId,
          kind: "run_agent_turn",
          systemPrompt: job.data.prompt,
        },
      } as Job<OutboundJobData>);
    },
    { connection, concurrency: 1 },
  );

  for (const w of [inbound, outbound, scheduled]) {
    w.on("failed", (job, err) => {
      console.error(
        `[pi-wechat] queue ${job?.queueName} job ${job?.id} failed:`,
        err.message,
      );
    });
  }

  workers.push(inbound, outbound, scheduled);

  const { loadAndRegisterSchedules } = await import("../schedules/registry.js");
  await loadAndRegisterSchedules();

  console.log(
    `[pi-wechat] queue workers started (inbound concurrency=${concurrency})`,
  );
}

export async function stopQueueWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  await closeQueues();
  await closeRedisConnection();
}
