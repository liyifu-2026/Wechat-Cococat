import type { Message, WeChatClient } from "@cococat/shared";
import { appendConsoleEvent } from "../console-events.js";
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
  listActiveMutes,
  loadChatEscalationState,
  loadMaintainerPending,
  maintainerMemoryPickTtlMs,
  muteChat,
  saveChatEscalationState,
  saveMaintainerPending,
  unmuteChat,
} from "./state-store.js";
import { decideCustomerEscalation } from "./decision.js";
import { downgradeExecutedWhenEscalationDisabled } from "./triage-normalize.js";
import { nextChatStateAfterExecuted } from "./triage-state.js";
import type { ExecutedAction } from "./triage-normalize.js";
import {
  formatMaintainerBlockedChat,
  formatMaintainerMenu,
} from "./maintainer-menu.js";
import {
  formatAgentHandoffAlert,
  formatEscalationAlert,
  formatLowConfidenceFyi,
  formatMuteListMessage,
  formatNoMutesToClear,
  formatUnmutePickPrompt,
  formatMaintainerActionBroadcast,
} from "./maintainer-notify.js";
import { formatWechatText } from "./wechat-line-wrap.js";
import type { MaintainerMessageOutcome } from "./types.js";
import type {
  EscalationConfig,
  PrivateTriageOutcome,
} from "./types.js";
import type { TranscriptEntry } from "../transcript.js";
import {
  tryMaintainerWikiOpsReply,
} from "../ops/wiki-sniff.js";
import {
  formatMemoryPickList,
  formatMemorySnapshot,
  parseMaintainerMemoryCommand,
  resolveMemoryTarget,
} from "../ops/memory-peek.js";
import { pickMaintainerCandidate } from "../ops/pick-candidate.js";
import type { MemoryClient } from "../memory-client.js";
import type { WikiClient } from "../wiki-client.js";

function combinedText(messages: Message[]): string {
  return messages
    .map((m) => m.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export class EscalationService {
  private _config: EscalationConfig;
  private readonly configFrozen: boolean;

  constructor(
    private client: WeChatClient,
    config?: EscalationConfig,
  ) {
    this.configFrozen = config !== undefined;
    this._config = config ?? loadEscalationConfigCached();
  }

  get config(): EscalationConfig {
    this.ensureConfigFresh();
    return this._config;
  }

  private ensureConfigFresh(): void {
    if (this.configFrozen) return;

    const prevIdentity = maintainerIdentity(this._config);
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
    const ids = new Set<string>();
    for (const m of this.config.maintainers) {
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

  /** @deprecated 使用 resolveAllMaintainerChatIds；保留首 id 供过渡 */
  private async resolveMaintainerChatId(): Promise<string | null> {
    const ids = await this.resolveAllMaintainerChatIds();
    return ids[0] ?? null;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await enqueueSend(async () => {
      await this.client.sendMessage({ chatId, text });
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

    const wikiReply = await tryMaintainerWikiOpsReply(
      body,
      ctx?.wikiClient,
      ctx?.wikiEnabled === true,
    );
    if (wikiReply !== null) {
      await this.sendText(actorChatId, wikiReply);
      return "handled";
    }

    const pending = loadMaintainerPending();
    if (pending?.action === "pick_memory") {
      const picked = pickMaintainerCandidate(pending.candidates, body);
      if (!picked) {
        await this.sendText(
          actorChatId,
          "没对上号。请回复序号（如 1）、更完整备注名，或 chatId。",
        );
        return "handled";
      }
      if (!ctx?.memoryClient) {
        await this.sendText(actorChatId, "Memory gateway 不可用。");
        saveMaintainerPending(null);
        return "handled";
      }
      saveMaintainerPending(null);
      const snapshot = await formatMemorySnapshot(
        picked,
        ctx.memoryClient,
      );
      await this.sendText(actorChatId, snapshot);
      return "handled";
    }

    if (pending?.action === "pick_unmute") {
      const picked = pickMaintainerCandidate(pending.candidates, body);
      if (!picked) {
        await this.sendText(
          actorChatId,
          "没对上号。请回复序号（如 1）或客户备注名。",
        );
        return "handled";
      }
      unmuteChat(picked.chatId);
      saveMaintainerPending(null);
      await this.notifyAllMaintainers(
        formatMaintainerActionBroadcast(
          operatorName,
          `已恢复对「${picked.chatName}」的自动回复。`,
        ),
      );
      return "handled";
    }

    if (/^菜单$/u.test(body)) {
      await this.sendText(
        actorChatId,
        formatMaintainerMenu({ wikiEnabled: ctx?.wikiEnabled === true }),
      );
      return "handled";
    }

    const memoryQuery = parseMaintainerMemoryCommand(body);
    if (memoryQuery !== null) {
      if (!ctx?.memoryClient) {
        await this.sendText(actorChatId, "Memory gateway 不可用。");
        return "handled";
      }
      const resolved = await resolveMemoryTarget(memoryQuery, this.client);
      switch (resolved.kind) {
        case "error":
          await this.sendText(actorChatId, resolved.message);
          return "handled";
        case "single": {
          const snapshot = await formatMemorySnapshot(
            resolved.candidate,
            ctx.memoryClient,
          );
          await this.sendText(actorChatId, snapshot);
          return "handled";
        }
        case "too_many":
          await this.sendText(
            actorChatId,
            `命中 ${resolved.count} 个，过多。请用 chatId 或更长备注名。`,
          );
          return "handled";
        case "pick":
          saveMaintainerPending({
            action: "pick_memory",
            query: resolved.query,
            candidates: resolved.candidates,
            expiresAt: Date.now() + maintainerMemoryPickTtlMs(),
          });
          await this.sendText(
            actorChatId,
            formatMemoryPickList(resolved.query, resolved.candidates),
          );
          return "handled";
      }
    }

    if (/^列表$/u.test(body)) {
      await this.sendText(actorChatId, formatMuteListMessage());
      return "handled";
    }

    if (/^(已处理|解除)$/u.test(body)) {
      const mutes = listActiveMutes();
      if (mutes.length === 0) {
        await this.sendText(actorChatId, formatNoMutesToClear());
        return "handled";
      }
      if (mutes.length === 1) {
        const only = mutes[0]!;
        unmuteChat(only.chatId);
        await this.notifyAllMaintainers(
          formatMaintainerActionBroadcast(
            operatorName,
            `已恢复对「${only.chatName}」的自动回复。`,
          ),
        );
        return "handled";
      }
      saveMaintainerPending({
        action: "pick_unmute",
        candidates: mutes.map((m) => ({
          chatId: m.chatId,
          chatName: m.chatName,
        })),
      });
      await this.sendText(
        actorChatId,
        formatUnmutePickPrompt(mutes.length),
      );
      return "handled";
    }

    const activeMutes = listActiveMutes();
    if (activeMutes.length > 0) {
      await this.sendText(
        actorChatId,
        formatMaintainerBlockedChat(activeMutes.length),
      );
      return "blocked";
    }

    return "chat";
  }

  shouldSkipMutedCustomer(chatId: string, chatName: string): boolean {
    if (!isChatMuted(chatId)) return false;
    console.log(`[pi-wechat] ${chatName}: muted — skip auto reply`);
    return true;
  }
}
