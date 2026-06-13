import { Queue } from "bullmq";
import { bullmqConnection } from "./redis.js";

export const INBOUND_QUEUE = "cococat:inbound";
export const OUTBOUND_QUEUE = "cococat:outbound";
export const SCHEDULED_QUEUE = "cococat:scheduled";

export type InboundJobData = {
  chatId: string;
  chatName: string;
  isGroup: boolean;
};

export type OutboundJobData = {
  chatId: string;
  chatName?: string;
  isGroup?: boolean;
  kind:
    | "send_text"
    | "run_agent_turn"
    | "thoughtful_turn"
    | "inbound_thoughtful_reply";
  text?: string;
  systemPrompt?: string;
  /** 入站 thoughtful：出站 @ 名单（与 inbound 一致） */
  replyMentions?: string[];
  /** drain 为空时的 fallback localId 列表 */
  userLocalIds?: number[];
};

export type ScheduledJobData = {
  scheduleId: string;
  chatId: string;
  prompt: string;
};

let inboundQueue: Queue<InboundJobData> | undefined;
let outboundQueue: Queue<OutboundJobData> | undefined;
let scheduledQueue: Queue<ScheduledJobData> | undefined;

export function getInboundQueue(): Queue<InboundJobData> {
  if (!inboundQueue) {
    inboundQueue = new Queue(INBOUND_QUEUE, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return inboundQueue;
}

export function getOutboundQueue(): Queue<OutboundJobData> {
  if (!outboundQueue) {
    outboundQueue = new Queue(OUTBOUND_QUEUE, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return outboundQueue;
}

export function getScheduledQueue(): Queue<ScheduledJobData> {
  if (!scheduledQueue) {
    scheduledQueue = new Queue(SCHEDULED_QUEUE, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return scheduledQueue;
}

export async function closeQueues(): Promise<void> {
  const queues = [inboundQueue, outboundQueue, scheduledQueue].filter(
    Boolean,
  ) as Queue[];
  await Promise.all(queues.map((q) => q.close()));
  inboundQueue = undefined;
  outboundQueue = undefined;
  scheduledQueue = undefined;
}
