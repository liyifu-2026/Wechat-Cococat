export type ScheduleEntry = {
  id: string;
  chatId: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
  chatName?: string;
  isGroup?: boolean;
};

export type QuietHours = {
  start: string;
  end: string;
  timezone?: string;
};

export type SchedulesFile = {
  jobs?: ScheduleEntry[];
  quietHours?: QuietHours;
  allowlistChatIds?: string[];
};
