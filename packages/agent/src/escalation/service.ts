import type { Message, WeChatClient } from "@cococat/shared";
import { appendConsoleEvent } from "../console-events.js";
import { loadEscalationConfig } from "./config.js";
import { enqueueSend } from "./send-queue.js";
import {
  isChatMuted,
  listActiveMutes,
  loadChatEscalationState,
  loadMaintainerPending,
  muteChat,
  saveChatEscalationState,
  saveMaintainerPending,
  unmuteChat,
} from "./state-store.js";
import { decideCustomerEscalation, decideCustomerEscalationRules, downgradeWhenEscalationDisabled } from "./decision.js";
import { nextChatStateAfterTriage } from "./triage.js";
import type {
  EscalationConfig,
  PrivateTriageOutcome,
  TriageResult,
} from "./types.js";
import type { TranscriptEntry } from "../transcript.js";

function combinedText(messages: Message[]): string {
  return messages
    .map((m) => m.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function formatMuteList(): string {
  const mutes = listActiveMutes();
  if (mutes.length === 0) {
    return "当前没有 mute 中的客户会话。";
  }
  return mutes
    .map((m, i) => {
      const leftMs = m.mutedUntil - Date.now();
      const leftH = Math.max(0, Math.ceil(leftMs / (60 * 60 * 1000)));
      const tag = m.reason === "escalate_a" ? "转人工" : "试探升级";
      return `${i + 1}) ${m.chatName}（${tag}，约剩 ${leftH}h）`;
    })
    .join("\n");
}

function formatAlert(params: {
  chatName: string;
  chatId: string;
  trigger: string;
  reason: string;
  userLines: string[];
  customerLineSent: boolean;
  muteHours: number;
}): string {
  const recent = params.userLines.slice(-4).map((l) => `- ${l}`);
  return [
    "【需处理】CocoCat",
    `客户：${params.chatName}`,
    `chatId：${params.chatId}`,
    `触发：${params.trigger}`,
    `原因：${params.reason}`,
    "最近原话：",
    ...recent,
    `对客户：${params.customerLineSent ? "已发转接话术" : "未发转接话术"}`,
    `mute：${params.muteHours}h`,
  ].join("\n");
}

export class EscalationService {
  readonly config: EscalationConfig;

  constructor(
    private client: WeChatClient,
    config?: EscalationConfig,
  ) {
    this.config = config ?? loadEscalationConfig();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isMaintainerChat(chatId: string): boolean {
    if (!this.config.enabled) return false;
    if (
      this.config.maintainerChatId &&
      chatId === this.config.maintainerChatId
    ) {
      return true;
    }
    return false;
  }

  private async resolveMaintainerChatId(): Promise<string | null> {
    if (this.config.maintainerChatId) return this.config.maintainerChatId;
    if (!this.config.maintainerDisplayName) return null;
    const chats = await this.client.findChats(this.config.maintainerDisplayName);
    const hit = chats[0];
    return hit?.id ?? null;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await enqueueSend(async () => {
      await this.client.sendMessage({ chatId, text });
    });
  }

  async notifyMaintainer(text: string): Promise<void> {
    if (!this.config.enabled) return;
    const maintainerId = await this.resolveMaintainerChatId();
    if (!maintainerId) {
      console.warn(
        "[pi-wechat] escalation: maintainer chatId not configured",
      );
      return;
    }
    await this.sendText(maintainerId, text);
  }

  triagePrivateChat(
    chatId: string,
    messages: Message[],
  ): TriageResult {
    const state = loadChatEscalationState(chatId);
    return decideCustomerEscalationRules({
      combinedText: combinedText(messages),
      chatState: state,
      config: this.config,
    });
  }

  async applyUnifiedPrivateGate(params: {
    chatId: string;
    chatName: string;
    messages: Message[];
    userLines: string[];
    transcriptEntries: TranscriptEntry[];
  }): Promise<PrivateTriageOutcome> {
    const { chatId, chatName, messages, userLines, transcriptEntries } = params;
    const prevState = loadChatEscalationState(chatId);
    const hybrid = await decideCustomerEscalation({
      combinedText: combinedText(messages),
      chatState: prevState,
      config: this.config,
      messages,
      transcriptEntries,
    });

    let action = hybrid.action;
    if (!this.config.enabled) {
      action = downgradeWhenEscalationDisabled(action);
    }

    const result: TriageResult = {
      action,
      reason: `${hybrid.reason}@${hybrid.source}`,
    };
    const nextState = nextChatStateAfterTriage(prevState, result);
    saveChatEscalationState(chatId, nextState);

    switch (result.action) {
      case "silent":
        console.log(
          `[pi-wechat] ${chatName}: unified gate silent (${result.reason})`,
        );
        return { status: "done" };
      case "reply":
        return { status: "continue", confidence: hybrid.confidence };
      case "ignore":
        console.log(
          `[pi-wechat] ${chatName}: unified gate ignore (${result.reason})`,
        );
        return { status: "done" };
      case "deflect":
        console.log(
          `[pi-wechat] ${chatName}: unified gate deflect (${result.reason})`,
        );
        await this.sendText(chatId, this.config.deflectLine);
        return { status: "done" };
      case "escalate_a":
        console.log(
          `[pi-wechat] ${chatName}: unified gate escalate (${result.reason})`,
        );
        await this.sendText(chatId, this.config.customerLine);
        muteChat(
          chatId,
          chatName,
          "escalate_a",
          this.config.muteHoursEscalate,
        );
        appendConsoleEvent({
          kind: "escalate_a",
          chatId,
          chatName,
          reason: result.reason,
          topic: userLines.at(-1)?.slice(0, 48),
        });
        if (this.config.notifyEscalate) {
          await this.notifyMaintainer(
            formatAlert({
              chatId,
              chatName,
              trigger: "escalate_a",
              reason: result.reason,
              userLines,
              customerLineSent: true,
              muteHours: this.config.muteHoursEscalate,
            }),
          );
        }
        return { status: "done" };
      case "probe_b":
        console.log(
          `[pi-wechat] ${chatName}: unified gate probe_b (${result.reason})`,
        );
        muteChat(
          chatId,
          chatName,
          "probe_b",
          this.config.muteHoursProbeLoop,
        );
        appendConsoleEvent({
          kind: "probe_b",
          chatId,
          chatName,
          reason: result.reason,
          topic: userLines.at(-1)?.slice(0, 48),
        });
        if (this.config.notifyProbeLoop) {
          await this.notifyMaintainer(
            formatAlert({
              chatId,
              chatName,
              trigger: "probe_b",
              reason: result.reason,
              userLines,
              customerLineSent: false,
              muteHours: this.config.muteHoursProbeLoop,
            }),
          );
        }
        return { status: "done" };
      default:
        return { status: "continue", confidence: hybrid.confidence };
    }
  }

  /** @deprecated 使用 applyUnifiedPrivateGate */
  async applyPrivateTriage(params: {
    chatId: string;
    chatName: string;
    messages: Message[];
    userLines: string[];
    transcriptEntries?: TranscriptEntry[];
  }): Promise<PrivateTriageOutcome> {
    return this.applyUnifiedPrivateGate({
      ...params,
      transcriptEntries: params.transcriptEntries ?? [],
    });
  }

  async maybeNotifyLowConfidence(params: {
    chatId: string;
    chatName: string;
    confidence?: number;
    userLines: string[];
  }): Promise<void> {
    if (!this.config.enabled || !this.config.notifyLowConfidence) return;
    const { confidence } = params;
    if (confidence === undefined || confidence >= this.config.lowConfidenceThreshold) {
      return;
    }
    appendConsoleEvent({
      kind: "low_confidence",
      chatId: params.chatId,
      chatName: params.chatName,
      confidence,
      topic: params.userLines.at(-1)?.slice(0, 48),
    });
    await this.notifyMaintainer(
      [
        "【低置信 FYI】CocoCat",
        `客户：${params.chatName}`,
        `chatId：${params.chatId}`,
        `confidence：${confidence.toFixed(2)}（阈值 ${this.config.lowConfidenceThreshold}）`,
        "最近原话：",
        ...params.userLines.slice(-3).map((l) => `- ${l}`),
        "说明：已自动回复客户；请留意是否需人工跟进。",
      ].join("\n"),
    );
  }

  async handleMaintainerMessage(text: string): Promise<void> {
    if (!this.config.enabled) return;

    const maintainerId = await this.resolveMaintainerChatId();
    if (!maintainerId) return;

    const body = text.trim();
    if (!body) return;

    const pending = loadMaintainerPending();
    if (pending?.action === "pick_unmute") {
      const picked = this.pickCandidate(pending.candidates, body);
      if (!picked) {
        await this.sendText(
          maintainerId,
          "没对上号。请回复序号（如 1）或客户备注名。",
        );
        return;
      }
      unmuteChat(picked.chatId);
      saveMaintainerPending(null);
      await this.sendText(
        maintainerId,
        `已恢复对「${picked.chatName}」的自动回复。`,
      );
      return;
    }

    if (/^列表$/u.test(body)) {
      await this.sendText(maintainerId, formatMuteList());
      return;
    }

    if (/^(已处理|解除)$/u.test(body)) {
      const mutes = listActiveMutes();
      if (mutes.length === 0) {
        await this.sendText(maintainerId, "当前没有需要解除的 mute 会话。");
        return;
      }
      if (mutes.length === 1) {
        const only = mutes[0]!;
        unmuteChat(only.chatId);
        await this.sendText(
          maintainerId,
          `已恢复对「${only.chatName}」的自动回复。`,
        );
        return;
      }
      saveMaintainerPending({
        action: "pick_unmute",
        candidates: mutes.map((m) => ({
          chatId: m.chatId,
          chatName: m.chatName,
        })),
      });
      await this.sendText(
        maintainerId,
        `目前有 ${mutes.length} 个 mute 会话：\n${formatMuteList()}\n请回复序号或客户名。`,
      );
      return;
    }

    await this.sendText(
      maintainerId,
      "可用指令：列表 / 已处理 / 解除",
    );
  }

  private pickCandidate(
    candidates: Array<{ chatId: string; chatName: string }>,
    input: string,
  ): { chatId: string; chatName: string } | null {
    const trimmed = input.trim();
    const asIndex = Number(trimmed);
    if (
      Number.isInteger(asIndex) &&
      asIndex >= 1 &&
      asIndex <= candidates.length
    ) {
      return candidates[asIndex - 1] ?? null;
    }
    const lower = trimmed.toLowerCase();
    return (
      candidates.find(
        (c) =>
          c.chatName === trimmed ||
          c.chatName.toLowerCase().includes(lower) ||
          lower.includes(c.chatName.toLowerCase()),
      ) ?? null
    );
  }

  shouldSkipMutedCustomer(chatId: string, chatName: string): boolean {
    if (!isChatMuted(chatId)) return false;
    console.log(`[pi-wechat] ${chatName}: muted — skip auto reply`);
    return true;
  }
}
