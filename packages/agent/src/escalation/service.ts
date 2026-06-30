import type { Message, WeChatClient } from "@cococat/shared";
import { appendConsoleEvent } from "../console-events.js";
import { sendWeChatSafely } from "../outbound-safety.js";
import {
  loadEscalationConfigCached,
  maintainerIdentity,
} from "./config.js";
import {
  displayNameForMaintainerChat,
} from "./maintainers.js";
import { enqueueSend } from "./send-queue.js";
import {
  isChatMuted,
  loadChatEscalationState,
  muteChat,
  saveChatEscalationState,
  saveMaintainerPending,
} from "./state-store.js";
import { decideCustomerEscalation } from "./decision.js";
import { downgradeExecutedWhenEscalationDisabled } from "./triage-normalize.js";
import { nextChatStateAfterExecuted } from "./triage-state.js";
import type { ExecutedAction } from "./triage-normalize.js";
import {
  formatAgentHandoffAlert,
  formatEscalationAlert,
  formatLowConfidenceFyi,
} from "./maintainer-notify.js";
import { formatMaintainerMenu } from "./maintainer-menu.js";
import { formatWechatText } from "./wechat-line-wrap.js";
import type { MaintainerMessageOutcome } from "./types.js";
import type {
  EscalationConfig,
  MaintainerInfo,
  PrivateTriageOutcome,
} from "./types.js";
import type { TranscriptEntry } from "../transcript.js";
import type { MemoryClient } from "../memory-client.js";
import type { WikiClient } from "../wiki-client.js";
import {
  createMemoryMaintainerCommandHandler,
  createMuteMaintainerCommandHandler,
  createWikiMaintainerCommandHandler,
  dispatchMaintainerCommand,
  type MaintainerCommandHandler,
} from "./maintainer-command-handler.js";

function combinedText(messages: Message[]): string {
  return messages
    .map((m) => m.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export class EscalationService {
  private _config: EscalationConfig;
  private readonly configFrozen: boolean;
  private readonly maintainerCommandHandlers: MaintainerCommandHandler[];

  constructor(
    private client: WeChatClient,
    config?: EscalationConfig,
  ) {
    this.configFrozen = config !== undefined;
    this._config = config ?? loadEscalationConfigCached();
    this.maintainerCommandHandlers = [
      createWikiMaintainerCommandHandler(),
      createMemoryMaintainerCommandHandler(),
      createMuteMaintainerCommandHandler(),
    ];
  }

  get config(): EscalationConfig {
    this.ensureConfigFresh();
    return this._config;
  }

  private ensureConfigFresh(): void {
    if (this.configFrozen) return;

    const prevIdentity = maintainerIdentity(this._config);
    const prevMaintainers = this._config.maintainers;
    this._config = loadEscalationConfigCached();
    const nextIdentity = maintainerIdentity(this._config);
    if (prevIdentity === nextIdentity) return;

    saveMaintainerPending(null);
    const count = this._config.maintainers.filter(
      (m) => m.chatId || m.displayName,
    ).length;
    console.log(
      `[pi-wechat] escalation: maintainer set changed (${count} configured)`,
    );
    void this.notifyNewMaintainers(prevMaintainers, this._config.maintainers);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isAgentHandoffEnabled(): boolean {
    return this.config.enabled && this.config.agentHandoffEnabled;
  }

  isMaintainerChat(chatId: string): boolean {
    if (!this.config.enabled) return false;
    return this.config.maintainers.some(
      (m) => m.chatId && m.chatId === chatId,
    );
  }

  private pickBestChatMatch<T extends { id?: string; name?: string }>(
    query: string,
    chats: T[],
  ): T | undefined {
    const q = query.trim().toLowerCase();
    if (!q || chats.length === 0) return undefined;
    const exact = chats.find(
      (c) => c.name?.trim().toLowerCase() === q,
    );
    if (exact?.id) return exact;
    const partial = chats.find((c) =>
      c.name?.trim().toLowerCase().includes(q),
    );
    if (partial?.id) return partial;
    return chats.find((c) => c.id) ?? chats[0];
  }

  private async resolveAllMaintainerChatIds(): Promise<string[]> {
    return this.resolveMaintainerChatIdsFrom(this.config.maintainers);
  }

  private async resolveMaintainerChatIdsFrom(
    maintainers: MaintainerInfo[],
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const m of maintainers) {
      if (m.chatId?.trim()) {
        ids.add(m.chatId.trim());
        continue;
      }
      if (!m.displayName?.trim()) continue;
      try {
        const chats = await this.client.findChats(m.displayName.trim());
        const hit = this.pickBestChatMatch(m.displayName, chats);
        if (hit?.id) ids.add(hit.id);
      } catch (err) {
        console.warn(
          `[pi-wechat] escalation: findChats failed for maintainer "${m.displayName}":`,
          err,
        );
      }
    }
    return [...ids];
  }

  private async notifyNewMaintainers(
    prevMaintainers: MaintainerInfo[],
    nextMaintainers: MaintainerInfo[],
  ): Promise<void> {
    const prevIdentitySet = new Set(
      prevMaintainers.map(
        (m) => m.chatId.trim() || `name:${m.displayName.trim()}`,
      ),
    );
    const added = nextMaintainers.filter((m) => {
      const key = m.chatId.trim() || `name:${m.displayName.trim()}`;
      return key && !prevIdentitySet.has(key);
    });
    if (added.length === 0) return;

    const ids = await this.resolveMaintainerChatIdsFrom(added);
    const menu = formatMaintainerMenu({ wikiEnabled: false });
    await Promise.allSettled(
      ids.map(async (id) => {
        try {
          await this.sendText(id, menu);
        } catch (err) {
          console.error(
            `[pi-wechat] escalation: failed to send maintainer menu ${id}:`,
            err,
          );
        }
      }),
    );
  }

  /** @deprecated 使用 resolveAllMaintainerChatIds；保留首 id 供过渡 */
  private async resolveMaintainerChatId(): Promise<string | null> {
    const ids = await this.resolveAllMaintainerChatIds();
    return ids[0] ?? null;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await enqueueSend(async () => {
      await sendWeChatSafely(this.client, { chatId, text });
    });
  }

  async notifyAllMaintainers(text: string | string[]): Promise<void> {
    if (!this.config.enabled) return;
    const ids = await this.resolveAllMaintainerChatIds();
    if (ids.length === 0) {
      console.warn(
        "[pi-wechat] escalation: no maintainer chatIds configured",
      );
      return;
    }
    const body = Array.isArray(text)
      ? formatWechatText(text)
      : text.includes("\n")
        ? formatWechatText(text.split("\n"))
        : formatWechatText([text]);

    await Promise.allSettled(
      ids.map(async (id) => {
        try {
          await this.sendText(id, body);
        } catch (err) {
          console.error(
            `[pi-wechat] escalation: failed to notify maintainer ${id}:`,
            err,
          );
        }
      }),
    );
  }

  async notifyMaintainer(text: string | string[]): Promise<void> {
    await this.notifyAllMaintainers(text);
  }

  async triagePrivateChat(
    chatId: string,
    messages: Message[],
    transcriptEntries: TranscriptEntry[] = [],
  ): Promise<
    Awaited<ReturnType<typeof decideCustomerEscalation>>
  > {
    const state = loadChatEscalationState(chatId);
    return decideCustomerEscalation({
      combinedText: combinedText(messages),
      chatState: state,
      config: this.config,
      messages,
      transcriptEntries,
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

    let executed = hybrid.executedAction;
    if (!this.config.enabled) {
      executed = downgradeExecutedWhenEscalationDisabled(executed);
    }

    const reason = `${hybrid.reason}@${hybrid.source}`;
    const nextState = nextChatStateAfterExecuted(prevState, executed);
    saveChatEscalationState(chatId, nextState);

    console.log(
      `[pi-wechat] ${chatName}: gate=${hybrid.gate} executed=${executed} display=${hybrid.action} (${reason})`,
    );

    return this.applyExecutedGate({
      chatId,
      chatName,
      executed,
      reason,
      confidence: hybrid.confidence,
      userLines,
    });
  }

  private async applyExecutedGate(params: {
    chatId: string;
    chatName: string;
    executed: ExecutedAction;
    reason: string;
    confidence: number;
    userLines: string[];
  }): Promise<PrivateTriageOutcome> {
    const { chatId, chatName, executed, reason, confidence, userLines } =
      params;

    switch (executed) {
      case "CONTINUE_AGENT":
        return { status: "continue", confidence };
      case "NO_REPLY":
        console.log(
          `[pi-wechat] ${chatName}: unified gate no_reply (${reason})`,
        );
        return { status: "done" };
      case "SEND_DEFLECT_LINE":
        console.log(
          `[pi-wechat] ${chatName}: unified gate deflect (${reason}) — customer silent`,
        );
        return { status: "done" };
      case "HANDOFF_ESCALATE":
        console.log(
          `[pi-wechat] ${chatName}: unified gate escalate (${reason}) — customer silent`,
        );
        muteChat(
          chatId,
          chatName,
          "escalate_a",
          this.config.muteHoursEscalate,
          { lastUserLine: userLines.at(-1) },
        );
        appendConsoleEvent({
          kind: "escalate_a",
          chatId,
          chatName,
          reason,
          topic: userLines.at(-1)?.slice(0, 48),
        });
        if (this.config.notifyEscalate) {
          await this.notifyMaintainer(
            formatEscalationAlert({
              chatId,
              chatName,
              trigger: "escalate_a",
              reason,
              userLines,
              muteHours: this.config.muteHoursEscalate,
            }),
          );
        }
        return { status: "done" };
      case "CODE_TRIGGERED_HANDOFF":
      case "HANDOFF_PROBE":
        console.log(
          `[pi-wechat] ${chatName}: unified gate probe handoff (${reason})`,
        );
        muteChat(
          chatId,
          chatName,
          "probe_b",
          this.config.muteHoursProbeLoop,
          { lastUserLine: userLines.at(-1) },
        );
        appendConsoleEvent({
          kind: "probe_b",
          chatId,
          chatName,
          reason,
          topic: userLines.at(-1)?.slice(0, 48),
        });
        if (this.config.notifyProbeLoop) {
          await this.notifyMaintainer(
            formatEscalationAlert({
              chatId,
              chatName,
              trigger: "probe_b",
              reason,
              userLines,
              muteHours: this.config.muteHoursProbeLoop,
            }),
          );
        }
        return { status: "done" };
      default:
        return { status: "continue", confidence };
    }
  }

  /** 主 Agent 工具 request_human_handoff：mute + 维护者告警（客户侧静默）。 */
  async applyAgentHandoff(params: {
    chatId: string;
    chatName: string;
    summary: string;
    reason: string;
    userLines: string[];
    turnId?: string;
  }): Promise<void> {
    if (!this.isAgentHandoffEnabled()) {
      console.warn(
        `[pi-wechat] ${params.chatName}: agent handoff skipped (disabled)`,
      );
      return;
    }
    if (isChatMuted(params.chatId)) {
      console.warn(
        `[pi-wechat] ${params.chatName}: agent handoff skipped (already muted)`,
      );
      return;
    }

    const { chatId, chatName, summary, reason, userLines, turnId } = params;
    console.log(
      `[pi-wechat] ${chatName}: agent handoff (${reason}) — customer silent — ${summary.slice(0, 80)}`,
    );

    muteChat(
      chatId,
      chatName,
      "escalate_a",
      this.config.muteHoursEscalate,
      { lastUserLine: userLines.at(-1) },
    );
    appendConsoleEvent({
      kind: "agent_handoff",
      chatId,
      chatName,
      turnId,
      reason: `${reason}: ${summary}`.slice(0, 240),
      topic: summary.slice(0, 48),
    });
    appendConsoleEvent({
      kind: "escalate_a",
      chatId,
      chatName,
      reason: `agent_handoff: ${summary}`.slice(0, 240),
      topic: summary.slice(0, 48),
    });

    if (this.config.notifyEscalate) {
      await this.notifyMaintainer(
        formatAgentHandoffAlert({
          chatId,
          chatName,
          reason,
          summary,
          userLines,
          muteHours: this.config.muteHoursEscalate,
        }),
      );
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
      formatLowConfidenceFyi({
        chatId: params.chatId,
        chatName: params.chatName,
        confidence,
        threshold: this.config.lowConfidenceThreshold,
        userLines: params.userLines,
      }),
    );
  }

  async handleMaintainerMessage(
    actorChatId: string,
    text: string,
    ctx?: {
      wikiEnabled?: boolean;
      wikiClient?: WikiClient;
      memoryClient?: MemoryClient;
    },
  ): Promise<MaintainerMessageOutcome> {
    if (!this.config.enabled) return "handled";
    if (!this.isMaintainerChat(actorChatId)) return "handled";

    const body = text.trim();
    if (!body) return "handled";

    const operatorName = displayNameForMaintainerChat(
      this.config.maintainers,
      actorChatId,
    );

    const commandOutcome = await dispatchMaintainerCommand(
      this.maintainerCommandHandlers,
      {
        actorChatId,
        body,
        operatorName,
        client: this.client,
        wikiEnabled: ctx?.wikiEnabled,
        wikiClient: ctx?.wikiClient,
        memoryClient: ctx?.memoryClient,
        sendText: (chatId, reply) => this.sendText(chatId, reply),
        notifyAllMaintainers: (reply) => this.notifyAllMaintainers(reply),
      },
    );
    if (commandOutcome !== undefined) return commandOutcome;

    return "chat";
  }

  shouldSkipMutedCustomer(chatId: string, chatName: string): boolean {
    if (!isChatMuted(chatId)) return false;
    console.log(`[pi-wechat] ${chatName}: muted — skip auto reply`);
    return true;
  }
}
