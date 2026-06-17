/** @deprecated Phase 2 起 Gate 使用 GateAction；保留供 Console 展示兼容 */
export type TriageAction =
  | "reply"
  | "silent"
  | "deflect"
  | "ignore"
  | "escalate_a"
  | "probe_b";

/** 统一 Gate 三档输出 */
export type GateAction = "continue" | "skip" | "handoff";

export type TriageResult = {
  action: TriageAction;
  reason: string;
};

export type MaintainerInfo = {
  chatId: string;
  displayName: string;
};

export type EscalationConfig = {
  enabled: boolean;
  /** @deprecated 首维护人镜像，便于过渡；以 maintainers 为准 */
  maintainerChatId: string;
  /** @deprecated 首维护人镜像 */
  maintainerDisplayName: string;
  maintainers: MaintainerInfo[];
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
  /** 主 Agent 可调用 request_human_handoff；默认 true */
  agentHandoffEnabled: boolean;
};

export type PrivateTriageOutcome = {
  status: "continue" | "done";
  confidence?: number;
};

export type MuteReason = "escalate_a" | "probe_b";

/** 维护者微信消息处理结果 */
export type MaintainerMessageOutcome = "handled" | "chat" | "blocked";

export type MuteEntry = {
  chatId: string;
  chatName: string;
  reason: MuteReason;
  mutedUntil: number;
  triggeredAt: string;
  /** mute 时客户最后一句原话，供维护者列表查看 */
  lastUserLine?: string;
};

export type ChatEscalationState = {
  deflectSent: boolean;
  probeStreak: number;
};

export type MaintainerPickCandidate = {
  chatId: string;
  chatName: string;
};

export type MemoryCandidate = MaintainerPickCandidate & {
  muteLabel: string;
  profileTags: string[];
  lastUserLine?: string;
};

export type MaintainerPending =
  | {
      action: "pick_unmute";
      candidates: MaintainerPickCandidate[];
    }
  | {
      action: "pick_memory";
      query: string;
      candidates: MemoryCandidate[];
      expiresAt: number;
    };
