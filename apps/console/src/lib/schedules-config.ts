export type QuietHours = {
  start: string
  end: string
}

export type ScheduleJob = {
  id: string
  chatId: string
  cron: string
  prompt: string
  enabled: boolean
}

export type SchedulesFile = {
  quietHours?: QuietHours
  allowlistChatIds: string[]
  jobs: ScheduleJob[]
}

export const DEFAULT_SCHEDULES: SchedulesFile = {
  quietHours: { start: "23:00", end: "08:00" },
  allowlistChatIds: [],
  jobs: [],
}

export function parseSchedules(raw: string): SchedulesFile {
  if (!raw.trim()) return { ...DEFAULT_SCHEDULES, jobs: [] }
  try {
    const data = JSON.parse(raw) as Partial<SchedulesFile>
    const quiet = data.quietHours
    return {
      quietHours:
        quiet && typeof quiet.start === "string" && typeof quiet.end === "string"
          ? { start: quiet.start, end: quiet.end }
          : DEFAULT_SCHEDULES.quietHours,
      allowlistChatIds: Array.isArray(data.allowlistChatIds)
        ? data.allowlistChatIds.filter((id) => typeof id === "string")
        : [],
      jobs: Array.isArray(data.jobs)
        ? data.jobs.map((j) => ({
            id: String(j.id ?? ""),
            chatId: String(j.chatId ?? ""),
            cron: String(j.cron ?? ""),
            prompt: String(j.prompt ?? ""),
            enabled: j.enabled === true,
          }))
        : [],
    }
  } catch {
    return { ...DEFAULT_SCHEDULES, jobs: [] }
  }
}
