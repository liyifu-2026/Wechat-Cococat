export type TriageAction =
  | "reply"
  | "silent"
  | "deflect"
  | "ignore"
  | "escalate_a"
  | "probe_b";

export type TriageResult = {
  action: TriageAction;
  reason: string;
};

export type EscalationConfig = {
  enabled: boolean;
  maintainerChatId: string;
  maintainerDisplayName: string;
  notifyEscalate: boolean;
  notifyProbeLoop: boolean;
  notifyLowConfidence: boolean;
  triageUseLlm: boolean;
  lowConfidenceThreshold: number;
  deflectLine: string;
  customerLine: string;
  muteHoursEscalate: number;
  muteHoursProbeLoop: number;
  probeStreakThreshold: number;
};

export type PrivateTriageOutcome = {
  status: "continue" | "done";
  confidence?: number;
};

export type MuteReason = "escalate_a" | "probe_b";

export type MuteEntry = {
  chatId: string;
  chatName: string;
  reason: MuteReason;
  mutedUntil: number;
  triggeredAt: string;
};

export type ChatEscalationState = {
  deflectSent: boolean;
  probeStreak: number;
};

export type MaintainerPending = {
  action: "pick_unmute";
  candidates: Array<{ chatId: string; chatName: string }>;
};
