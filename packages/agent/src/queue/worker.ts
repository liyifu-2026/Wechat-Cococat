import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "../config.js";
import type { SessionManager } from "../session.js";
import { drainPendingLocalIds, restorePendingLocalIds } from "./pending.js";
import { collectUnseenLocalIds } from "./enqueue.js";
import {
  filterUnseenLocalIds,
  markSeenLocalIds,
  snapshotAlreadyAnswered,
} from "./snapshot-guard.js";
import {
  evaluateInboundFastDiscard,
  logFastDiscard,
} from "./fast-discard.js";
import { reconcileTranscriptForChat } from "../reconcile-transcript.js";
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
import { appendInboundDeadLetter } from "./dead-letter.js";

const workers: Worker[] = [];

type InboundWorkerJob = Pick<Job<InboundJobData>, "data" | "log">;

export async function handleInboundJob(
  job: InboundWorkerJob,
  params: {
    redis: Redis;
    client: WeChatClient;
    config: PiWeChatConfig;
    manager: SessionManager;
  },
): Promise<void> {
  const { redis, client, config, manager } = params;
  const { chatId, chatName, isGroup } = job.data;
  let snapshot = await drainPendingLocalIds(redis, chatId);
  let drainedFromPending = snapshot.length > 0;

  try {
    if (snapshot.length === 0) {
      snapshot = await collectUnseenLocalIds(client, chatId);
      drainedFromPending = false;
    }

    snapshot = filterUnseenLocalIds(chatId, snapshot);

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
        throw new Error("memory unavailable; inbound job will retry");
      }
      markSeenLocalIds(chatId, fastDiscard.localIds);
      logFastDiscard(chatName, fastDiscard.reason, chatId);
      job.log(`fast-discard: ${fastDiscard.reason}`);
      if (fastDiscard.reason === "agent_proxy_off") {
        try {
          await reconcileTranscriptForChat(client, chatId);
        } catch (err) {
          job.log(
            `reconcile after agent_proxy_off failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return;
    }

    await manager
      .get(chatId)
      .processSnapshot(chatName, isGroup, snapshot, {
        replyGuardChecked: true,
      });
  } catch (err) {
    if (drainedFromPending && snapshot.length > 0) {
      await restorePendingLocalIds(redis, chatId, snapshot);
    }
    throw err;
  }
}

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
      await handleInboundJob(job, { redis, client, config, manager });
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
      if (
        job?.queueName === INBOUND_QUEUE &&
        job.attemptsMade >= (job.opts.attempts ?? 1)
      ) {
        try {
          appendInboundDeadLetter({
            queueName: job.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            failedReason: err.message,
            data: job.data as InboundJobData,
          });
        } catch (archiveErr) {
          console.error(
            "[pi-wechat] failed to archive inbound dead letter:",
            archiveErr instanceof Error ? archiveErr.message : archiveErr,
          );
        }
      }
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
