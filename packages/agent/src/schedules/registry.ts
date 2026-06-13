import { existsSync, readFileSync } from "node:fs";
import { resolveConfigPath } from "../paths.js";
import { getScheduledQueue } from "../queue/queues.js";
import type { SchedulesFile } from "./types.js";

const SCHEDULES_PATH =
  process.env.COCOCAT_SCHEDULES_PATH?.trim() ||
  resolveConfigPath("schedules.json");

export function loadSchedulesFile(): SchedulesFile {
  if (!existsSync(SCHEDULES_PATH)) return { jobs: [] };
  try {
    return JSON.parse(readFileSync(SCHEDULES_PATH, "utf8")) as SchedulesFile;
  } catch (err) {
    console.warn("[pi-wechat] schedules.json parse failed:", err);
    return { jobs: [] };
  }
}

export async function loadAndRegisterSchedules(): Promise<void> {
  const file = loadSchedulesFile();
  const queue = getScheduledQueue();

  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === "cron_tick") {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  for (const entry of file.jobs ?? []) {
    if (entry.enabled === false) continue;
    await queue.add(
      "cron_tick",
      {
        scheduleId: entry.id,
        chatId: entry.chatId,
        prompt: entry.prompt,
      },
      {
        jobId: `schedule:${entry.id}`,
        repeat: { pattern: entry.cron },
      },
    );
    console.log(
      `[pi-wechat] registered schedule ${entry.id} (${entry.cron}) → ${entry.chatId}`,
    );
  }
}
