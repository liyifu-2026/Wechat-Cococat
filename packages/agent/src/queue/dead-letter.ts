import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../paths.js";
import type { InboundJobData } from "./queues.js";

export type InboundDeadLetter = {
  ts: string;
  queueName?: string;
  jobId?: string;
  attemptsMade: number;
  failedReason: string;
  data: InboundJobData;
};

function deadLetterPath(): string {
  return join(dataDir(), "queue-dead-letter.jsonl");
}

export function appendInboundDeadLetter(
  letter: Omit<InboundDeadLetter, "ts"> & { ts?: string },
): void {
  const line: InboundDeadLetter = {
    ts: letter.ts ?? new Date().toISOString(),
    queueName: letter.queueName,
    jobId: letter.jobId,
    attemptsMade: letter.attemptsMade,
    failedReason: letter.failedReason,
    data: letter.data,
  };

  const path = deadLetterPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}

export function inboundDeadLetterPath(): string {
  return deadLetterPath();
}
