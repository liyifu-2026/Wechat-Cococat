import {
  Agent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import { getModel, getModels, type KnownProvider } from "@earendil-works/pi-ai";
import type { Message, WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "./config.js";
import {
  ensureChatContext,
  updateChatMeta,
  type ChatContext,
} from "./chat-store.js";
import { applyDelay } from "./delays.js";
import {
  resolveGroupPolicy,
} from "./group-reply-policy.js";
import { evaluateInboundGate } from "./inbound-gate.js";
import { finalizeInboundTurn, finalizeProactiveTurn } from "./finalize-inbound-turn.js";
import { runInboundTurn, runThoughtfulInboundTurn } from "./run-inbound-turn.js";
import { SeenStore } from "./seen.js";
import { sendAssistantTextFallback } from "./reply.js";
import { stripReasoningFromAgent } from "./reasoning.js";
import { buildSystemPrompt, resolveWikiScopePrompt } from "./system-prompt.js";
import {
  appendTurnToTranscript,
  dbMessagesToTranscript,
  loadTranscript,
  patchTranscriptCaptions,
  patchTranscriptTailMediaCaptions,
  saveTranscript,
  transcriptNeedsRebuild,
  type TranscriptEntry,
} from "./transcript.js";
import { consumeCaptionDirty } from "./caption-dirty.js";
import type { EscalationService } from "./escalation/service.js";
import {
  evaluateReplySkip,
  replyCooldownMs,
} from "./reply-guard.js";
import {
  createWeChatTools,
  resolveMaxSendsPerTurn,
  WECHAT_OUTBOUND_TOOL_NAMES,
} from "./tools.js";
import { isServicePersona } from "./style.js";
import { prepareServiceOutboundText } from "./stealth-send.js";
import {
  appendAgentTrace,
  createTurnId,
  extractAllThinking,
  extractAssistantDraft,
  wrapToolsWithTrace,
} from "./agent-trace.js";
import { ensureChatWikiAutoBound } from "./wiki-auto-bind.js";
import { createWikiTools } from "./wiki-tools.js";
import { isQueueEnabled } from "./queue/redis.js";
import { cancelPendingOutboundForChat } from "./queue/cancel-pending-outbound.js";
import { createScheduleTools } from "./schedule-tools.js";
import type { MimoAudioInput } from "./mimo-audio.js";
import { applyPayloadHooks } from "./payload-hooks.js";
import {
  runThoughtfulTurn,
  shouldUseThoughtful,
} from "./thoughtful.js";
import type { ImageContent } from "@earendil-works/pi-ai";

function messageKey(localId: number): string {
  return String(localId);
}

function resolveModel(provider: string, modelId: string) {
  const p = provider as KnownProvider;
  const models = getModels(p);
  const found = models.find((m) => m.id === modelId);
  if (found) return found;
  if (models.length > 0) {
    console.warn(
      `[pi-wechat] model ${modelId} not found for ${provider}, using ${models[0]!.id}`,
    );
    return models[0]!;
  }
  return getModel(p, modelId as never);
}

export class ChatSession {
  private agent: Agent;
  private sendCountRef = { current: 0 };
  private sentTextsRef: { current: string[] } = { current: [] };
  private busy = false;
  private transcriptLoaded = false;
  private transcriptEntries: TranscriptEntry[] = [];
  private replyMentionsRef: { current: string[] | undefined } = {
    current: undefined,
  };
  private pendingAudiosRef: { current: MimoAudioInput[] } = { current: [] };
  private pendingVoiceCaptionRef: { current: boolean } = { current: false };
  private pendingSystemRef: { current: string } = { current: "" };
  private seenStore: SeenStore;
  private lastTriageConfidence?: number;
  private maxSendsPerTurn: number;
  private gatherBlockSendRef = { current: false };
  private stealthRetriedRef = { current: false };
  private currentTurnId?: string;

  constructor(
    private client: WeChatClient,
    private chatCtx: ChatContext,
    private config: PiWeChatConfig,
    private groupBuffers: Map<string, Message[]>,
    private escalation?: EscalationService,
  ) {
    this.seenStore = new SeenStore(chatCtx.seenPath, chatCtx.chatId);
    this.maxSendsPerTurn = resolveMaxSendsPerTurn(
      chatCtx.style.maxSendsPerTurn,
    );

    const baseTools = createWeChatTools({
      client,
      chatId: chatCtx.chatId,
      isGroup: chatCtx.chatId.includes("@chatroom"),
      sendCountRef: this.sendCountRef,
      sentTextsRef: this.sentTextsRef,
      burstDelayMs: chatCtx.style.burstDelayMs,
      replyMentionsRef: this.replyMentionsRef,
      maxSendsPerTurn: this.maxSendsPerTurn,
      stealthRetriedRef: this.stealthRetriedRef,
      serviceStealthEnabled: isServicePersona(chatCtx.style),
    });

    const extraTools: AgentTool[] = [];
    if (config.wikiClient) {
      config.wikiClient.setProjectAliases(chatCtx.wiki.projects);
      extraTools.push(
        ...createWikiTools(config.wikiClient, {
          chatId: chatCtx.chatId,
        }),
      );
    }

    if (isQueueEnabled()) {
      extraTools.push(...createScheduleTools({ chatId: chatCtx.chatId }));
    }

    const tools = wrapToolsWithTrace([...baseTools, ...extraTools], {
      chatId: chatCtx.chatId,
      getTurnId: () => this.currentTurnId,
    });

    this.agent = new Agent({
      initialState: {
        systemPrompt: "",
        model: resolveModel(config.provider, config.model),
        tools,
      },
      toolExecution: "sequential",
      transformContext: async (messages) => {
        if (this.transcriptEntries.length === 0) return messages;
        const lines = this.transcriptEntries.map((e) =>
          e.role === "assistant" ? `我: ${e.text}` : e.text,
        );
        const block: AgentMessage = {
          role: "user",
          content: `【近期对话】\n${lines.join("\n")}`,
          timestamp: Date.now() - 1000,
        };
        return [block, ...messages];
      },
      beforeToolCall: async (ctx) => {
        if (!WECHAT_OUTBOUND_TOOL_NAMES.has(ctx.toolCall.name)) {
          return undefined;
        }
        if (this.gatherBlockSendRef.current) {
          return {
            block: true,
            reason: "调研阶段不可发微信，请先整理要点。",
          };
        }
        if (this.sendCountRef.current >= this.maxSendsPerTurn) {
          return {
            block: true,
            reason: `每轮最多 ${this.maxSendsPerTurn} 条微信。`,
          };
        }
        if (this.sendCountRef.current === 0) {
          await applyDelay(this.chatCtx.style.replyDelayMs);
        }
        if (
          isServicePersona(this.chatCtx.style) &&
          ctx.toolCall.name === "wechat_send_message"
        ) {
          const raw = (ctx.toolCall.arguments as { text?: string })?.text ?? "";
          const prepared = prepareServiceOutboundText(
            raw,
            this.stealthRetriedRef,
          );
          if (!prepared.ok && prepared.retry) {
            return {
              block: true,
              reason: `文案含禁词（${prepared.hits.join("、")}），请改写，不要提 AI/机器人/知识库。`,
            };
          }
        }
        return undefined;
      },
      onPayload: (payload) => {
        let next = applyPayloadHooks(
          payload,
          this.pendingSystemRef.current,
          this.pendingAudiosRef.current,
          this.pendingVoiceCaptionRef.current,
        );
        this.pendingAudiosRef.current = [];
        return next;
      },
      onResponse: async () => {
        stripReasoningFromAgent(this.agent);
      },
    });
  }

  private async hydrateTranscript(isGroup: boolean): Promise<void> {
    if (this.transcriptLoaded) return;

    const limit =
      this.chatCtx.style.historyLimit ?? this.config.historyLimit;
    const dbMessages = await this.client.listMessages(
      this.chatCtx.chatId,
      limit,
    );

    let entries = loadTranscript(this.chatCtx.transcriptPath);
    const dirtyIds = consumeCaptionDirty(this.chatCtx.chatId);
    if (dirtyIds.length > 0 && entries.length > 0) {
      entries = patchTranscriptCaptions(
        entries,
        dirtyIds,
        this.chatCtx.captionsDir,
        isGroup,
      );
      saveTranscript(this.chatCtx.transcriptPath, entries);
    }

    if (entries.length > 0) {
      const tailWindow = Number(process.env.CAPTION_TAIL_WINDOW ?? "10");
      const patched = patchTranscriptTailMediaCaptions(
        entries,
        this.chatCtx.captionsDir,
        isGroup,
        Number.isNaN(tailWindow) ? 10 : tailWindow,
      );
      if (patched !== entries) {
        entries = patched;
        saveTranscript(this.chatCtx.transcriptPath, entries);
      }
    }

    if (
      entries.length === 0 ||
      transcriptNeedsRebuild(
        this.chatCtx.meta.lastLocalId,
        dbMessages,
        entries,
      )
    ) {
      entries = dbMessagesToTranscript(
        dbMessages,
        isGroup,
        this.chatCtx.captionsDir,
        limit,
      );
      saveTranscript(this.chatCtx.transcriptPath, entries);
    }

    if (entries.length > 0) {
      this.transcriptEntries = entries;
    }

    const maxLocalId = dbMessages.reduce(
      (max, m) => (m.localId > max ? m.localId : max),
      0,
    );
    if (maxLocalId > 0) {
      updateChatMeta(this.chatCtx, { lastLocalId: maxLocalId });
    }

    this.transcriptLoaded = true;
  }

  private markSeen(messages: Message[]): void {
    for (const m of messages) {
      this.seenStore.add(messageKey(m.localId));
    }
    this.seenStore.persist();
  }

  private async prepareWikiBinding(): Promise<void> {
    if (!this.config.wikiClient) return;
    await this.config.wikiClient.syncRegistry();
    await ensureChatWikiAutoBound(this.chatCtx, this.config.wikiClient);
    this.config.wikiClient.setProjectAliases(this.chatCtx.wiki.projects);
  }

  async process(chatName: string, isGroup: boolean): Promise<void> {
    if (this.busy) return;
    const messages = await this.client.listMessages(this.chatCtx.chatId, 40);
    const unseen = messages.filter(
      (m) => !m.isSelf && !this.seenStore.has(messageKey(m.localId)),
    );
    if (unseen.length === 0) return;
    await this.processUnseen(chatName, isGroup, unseen);
  }

  async processSnapshot(
    chatName: string,
    isGroup: boolean,
    snapshotLocalIds: number[],
    opts?: { replyGuardChecked?: boolean },
  ): Promise<void> {
    if (this.busy) return;
    const idSet = new Set(snapshotLocalIds);
    const messages = await this.client.listMessages(this.chatCtx.chatId, 40);
    let unseen = messages.filter(
      (m) => !m.isSelf && idSet.has(m.localId),
    );
    if (unseen.length === 0) {
      unseen = messages.filter(
        (m) =>
          !m.isSelf && !this.seenStore.has(messageKey(m.localId)),
      );
    }
    if (unseen.length === 0) return;
    await this.processUnseen(chatName, isGroup, unseen, opts);
  }

  async runProactiveTurn(params: {
    chatName: string;
    isGroup: boolean;
    systemPrompt?: string;
    thoughtful?: boolean;
  }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.prepareWikiBinding();
      const isGroupChat =
        params.isGroup || this.chatCtx.chatId.includes("@chatroom");
      await this.hydrateTranscript(isGroupChat);

      const taskLine = params.systemPrompt?.trim() || "【主动任务】请执行。";
      const longTermMemory = await this.config.memoryClient.recall(
        this.chatCtx.chatId,
        taskLine.slice(0, 500),
      );

      this.pendingSystemRef.current = buildSystemPrompt({
        chatName: params.chatName,
        isGroup: isGroupChat,
        personaPath: this.chatCtx.personaPath,
        envOverride: [
          this.config.systemPrompt,
          params.systemPrompt,
        ]
          .filter(Boolean)
          .join("\n\n"),
        wikiEnabled: this.config.wikiEnabled,
        wikiScopePrompt: resolveWikiScopePrompt(
          this.config.wikiEnabled,
          this.chatCtx.wiki.projects,
          this.config.wikiClient?.getRegistry(),
        ),
        longTermMemory,
      });

      this.sendCountRef.current = 0;
      this.sentTextsRef.current = [];
      this.stealthRetriedRef.current = false;

      await this.runPromptTurn(taskLine, [], {
        forceThoughtful: params.thoughtful === true,
        userLines: [taskLine],
        chatName: params.chatName,
        inlineThoughtfulOk: true,
      });

      stripReasoningFromAgent(this.agent);
      const fallbackSent = await sendAssistantTextFallback(
        this.agent,
        this.client,
        this.chatCtx.chatId,
        this.sendCountRef.current,
        undefined,
        this.chatCtx.style.burstDelayMs,
        this.maxSendsPerTurn,
        {
          serviceStealthEnabled: isServicePersona(this.chatCtx.style),
          stealthRetriedRef: this.stealthRetriedRef,
        },
      );
      this.sentTextsRef.current.push(...fallbackSent);
      this.traceReplySummary(params.chatName);

      finalizeProactiveTurn({
        chatCtx: this.chatCtx,
        sentTexts: this.sentTextsRef.current,
      });
    } finally {
      this.busy = false;
      this.agent.state.messages = [];
    }
  }

  /** outbound 队列：入站 thoughtful 两阶段回复（Gather→Compose→发送）。 */
  async runInboundThoughtfulReply(params: {
    chatName: string;
    isGroup: boolean;
    userLocalIds: number[];
    replyMentions?: string[];
  }): Promise<void> {
    if (this.busy) {
      throw new Error(`session busy: ${this.chatCtx.chatId}`);
    }

    this.busy = true;
    try {
      const isGroupChat =
        params.isGroup || this.chatCtx.chatId.includes("@chatroom");
      await this.hydrateTranscript(isGroupChat);

      const idSet = new Set(params.userLocalIds);
      const messages = await this.client.listMessages(this.chatCtx.chatId, 40);
      const unseen = messages.filter(
        (m) => !m.isSelf && idSet.has(m.localId),
      );
      if (unseen.length === 0) {
        console.warn(
          `[pi-wechat] ${params.chatName}: thoughtful outbound — no messages for localIds`,
        );
        return;
      }

      this.currentTurnId = createTurnId(
        this.chatCtx.chatId,
        params.userLocalIds,
      );

      const { userLines, sentTexts } = await runThoughtfulInboundTurn({
        client: this.client,
        config: this.config,
        chatCtx: this.chatCtx,
        agent: this.agent,
        chatName: params.chatName,
        isGroupChat,
        unseen,
        turnId: this.currentTurnId,
        replyMentions: params.replyMentions,
        sendCountRef: this.sendCountRef,
        sentTextsRef: this.sentTextsRef,
        replyMentionsRef: this.replyMentionsRef,
        pendingSystemRef: this.pendingSystemRef,
        pendingAudiosRef: this.pendingAudiosRef,
        pendingVoiceCaptionRef: this.pendingVoiceCaptionRef,
        maxSendsPerTurn: this.maxSendsPerTurn,
        stealthRetriedRef: this.stealthRetriedRef,
        runThoughtfulTurn: async (prompt, images) => {
          const thoughtful = await runThoughtfulTurn({
            agent: this.agent,
            client: this.client,
            chatId: this.chatCtx.chatId,
            chatName: params.chatName,
            turnId: this.currentTurnId,
            style: this.chatCtx.style,
            userPrompt: prompt,
            images,
            gatherBlockSendRef: this.gatherBlockSendRef,
            sendCountRef: this.sendCountRef,
          });
          this.traceModelOutput(params.chatName);
          if (thoughtful.ackLine) {
            this.sentTextsRef.current.push(thoughtful.ackLine);
          }
        },
        traceReplySummary: (name) => this.traceReplySummary(name),
      });

      const groupPolicy = resolveGroupPolicy(
        this.config.group,
        this.chatCtx.chatId,
        this.chatCtx,
      );
      await finalizeInboundTurn({
        chatCtx: this.chatCtx,
        config: this.config,
        chatName: params.chatName,
        isGroupChat,
        unseen,
        userLines,
        sentTexts,
        groupPolicy,
        groupBuffers: this.groupBuffers,
        escalation: this.escalation,
        lastTriageConfidence: this.lastTriageConfidence,
        assistantOnlyTranscript: true,
      });
      this.transcriptEntries = loadTranscript(this.chatCtx.transcriptPath);
      this.agent.state.messages = [];

      console.log(
        `[pi-wechat] ${params.chatName}: outbound thoughtful complete (${this.sentTextsRef.current.length} send(s))`,
      );
    } finally {
      this.busy = false;
      this.replyMentionsRef.current = undefined;
      this.pendingAudiosRef.current = [];
      this.pendingVoiceCaptionRef.current = false;
    }
  }

  private traceModelOutput(chatName?: string): void {
    const thinking = extractAllThinking(this.agent);
    if (thinking) {
      appendAgentTrace({
        chatId: this.chatCtx.chatId,
        chatName,
        turnId: this.currentTurnId,
        phase: "thinking",
        detail: thinking,
      });
    }
    const draft = extractAssistantDraft(this.agent);
    if (draft) {
      appendAgentTrace({
        chatId: this.chatCtx.chatId,
        chatName,
        turnId: this.currentTurnId,
        phase: "compose",
        detail: draft,
      });
    }
  }

  private traceReplySummary(chatName?: string): void {
    if (this.sentTextsRef.current.length === 0) return;
    appendAgentTrace({
      chatId: this.chatCtx.chatId,
      chatName,
      turnId: this.currentTurnId,
      phase: "reply",
      query: `${this.sentTextsRef.current.length} 条`,
      detail: this.sentTextsRef.current.join("\n---\n"),
    });
  }

  private async runPromptTurn(
    prompt: string,
    images: ImageContent[],
    opts: {
      forceThoughtful?: boolean;
      userLines: string[];
      chatName?: string;
      /** outbound 主动任务等已在 outbound worker 内执行 thoughtful */
      inlineThoughtfulOk?: boolean;
    },
  ): Promise<void> {
    const useThoughtful =
      opts.forceThoughtful === true ||
      shouldUseThoughtful(this.chatCtx.style, opts.userLines);

    if (useThoughtful && this.config.queueEnabled && !opts.inlineThoughtfulOk) {
      throw new Error(
        "[pi-wechat] thoughtful must run on outbound queue when enabled",
      );
    }

    if (useThoughtful) {
      const thoughtful = await runThoughtfulTurn({
        agent: this.agent,
        client: this.client,
        chatId: this.chatCtx.chatId,
        chatName: opts.chatName,
        turnId: this.currentTurnId,
        style: this.chatCtx.style,
        userPrompt: prompt,
        images,
        gatherBlockSendRef: this.gatherBlockSendRef,
        sendCountRef: this.sendCountRef,
      });
      this.traceModelOutput(opts.chatName);
      stripReasoningFromAgent(this.agent);
      if (thoughtful.ackLine) {
        this.sentTextsRef.current.push(thoughtful.ackLine);
      }
      return;
    }

    if (images.length > 0) {
      await this.agent.prompt(prompt, images);
    } else {
      await this.agent.prompt(prompt);
    }
    this.traceModelOutput(opts.chatName);
  }

  private async processUnseen(
    chatName: string,
    isGroup: boolean,
    unseen: Message[],
    opts?: { replyGuardChecked?: boolean },
  ): Promise<void> {
    this.busy = true;
    try {
      await this.prepareWikiBinding();
      await cancelPendingOutboundForChat(this.chatCtx.chatId);

      const isGroupChat = isGroup || this.chatCtx.chatId.includes("@chatroom");

      const earlyGate = await evaluateInboundGate({
        chatId: this.chatCtx.chatId,
        chatName,
        isGroup,
        unseen,
        group: this.config.group,
        groupBuffers: this.groupBuffers,
        chatCtx: this.chatCtx,
        escalation: this.escalation,
        memoryHealth: this.config.memoryHealth,
        transcriptEntries: loadTranscript(this.chatCtx.transcriptPath),
        mode: "full",
        skipReplyGuard: true,
      });

      if (earlyGate.action === "discard") {
        if (earlyGate.reason === "group_buffer") {
          console.log(
            `[pi-wechat] ${chatName}: buffered ${earlyGate.unseen.length} group message(s) (mention required)`,
          );
          appendAgentTrace({
            chatId: this.chatCtx.chatId,
            chatName,
            turnId: createTurnId(
              this.chatCtx.chatId,
              earlyGate.unseen.map((m) => m.localId),
            ),
            phase: "buffer",
            query: `+${earlyGate.unseen.length} 条入 buffer`,
            detail: earlyGate.unseen
              .map((m) => m.content?.trim() || `localId=${m.localId}`)
              .join("\n"),
          });
        } else if (earlyGate.reason === "triage_done") {
          const previewLines = earlyGate.unseen
            .map((m) => m.content?.trim() ?? "")
            .filter(Boolean);
          appendAgentTrace({
            chatId: this.chatCtx.chatId,
            chatName,
            turnId: createTurnId(
              this.chatCtx.chatId,
              earlyGate.unseen.map((m) => m.localId),
            ),
            phase: "triage",
            query: "done",
            detail: previewLines.join("\n") || "(空)",
          });
        } else if (earlyGate.reason === "memory_unavailable") {
          console.warn(
            `[pi-wechat] ${chatName}: Memory unavailable — suspend (no markSeen)`,
          );
          appendAgentTrace({
            chatId: this.chatCtx.chatId,
            chatName,
            turnId: createTurnId(
              this.chatCtx.chatId,
              earlyGate.unseen.map((m) => m.localId),
            ),
            phase: "skip",
            query: "memory_unavailable",
            detail: "await retry",
          });
        }
        if (earlyGate.shouldMarkSeen) {
          this.markSeen(earlyGate.unseen);
        }
        return;
      }

      unseen = earlyGate.unseen;
      const { wasMentioned, groupPolicy, injectedBufferCount } = earlyGate;
      this.lastTriageConfidence = earlyGate.lastTriageConfidence;

      if (injectedBufferCount > 0) {
        console.log(
          `[pi-wechat] ${chatName}: injected ${injectedBufferCount} buffered message(s)`,
        );
      }

      if (!isGroupChat && this.escalation?.isEnabled()) {
        const previewLines = unseen
          .map((m) => m.content?.trim() ?? "")
          .filter(Boolean);
        appendAgentTrace({
          chatId: this.chatCtx.chatId,
          chatName,
          turnId: createTurnId(
            this.chatCtx.chatId,
            unseen.map((m) => m.localId),
          ),
          phase: "triage",
          query: `continue · conf=${earlyGate.lastTriageConfidence ?? "?"}`,
          detail: previewLines.join("\n") || "(空)",
          confidence: earlyGate.lastTriageConfidence,
        });
      }

      await this.hydrateTranscript(isGroupChat);

      if (!opts?.replyGuardChecked) {
        const skipReason = evaluateReplySkip({
          chatId: this.chatCtx.chatId,
          cooldownMs: replyCooldownMs(this.chatCtx.style.replyCooldownMs),
          transcriptEntries: this.transcriptEntries,
          wasMentioned,
        });
        if (skipReason) {
          console.log(
            `[pi-wechat] ${chatName}: skip auto reply (${skipReason})`,
          );
          appendAgentTrace({
            chatId: this.chatCtx.chatId,
            chatName,
            turnId: createTurnId(
              this.chatCtx.chatId,
              unseen.map((m) => m.localId),
            ),
            phase: "skip",
            query: wasMentioned ? "mentioned" : "not_mentioned",
            detail: skipReason,
          });
          this.markSeen(unseen);
          return;
        }
      }

      this.currentTurnId = createTurnId(
        this.chatCtx.chatId,
        unseen.map((m) => m.localId),
      );
      this.stealthRetriedRef.current = false;

      const turnResult = await runInboundTurn({
        client: this.client,
        config: this.config,
        chatCtx: this.chatCtx,
        agent: this.agent,
        chatName,
        isGroupChat,
        unseen,
        wasMentioned,
        groupPolicy,
        injectedBufferCount,
        turnId: this.currentTurnId,
        groupBuffers: this.groupBuffers,
        sendCountRef: this.sendCountRef,
        sentTextsRef: this.sentTextsRef,
        replyMentionsRef: this.replyMentionsRef,
        pendingSystemRef: this.pendingSystemRef,
        pendingAudiosRef: this.pendingAudiosRef,
        pendingVoiceCaptionRef: this.pendingVoiceCaptionRef,
        maxSendsPerTurn: this.maxSendsPerTurn,
        stealthRetriedRef: this.stealthRetriedRef,
        runPromptTurn: (prompt, images, opts) =>
          this.runPromptTurn(prompt, images, opts),
        traceReplySummary: (name) => this.traceReplySummary(name),
      });

      if (turnResult.status === "thoughtful_offloaded") {
        this.transcriptEntries = loadTranscript(this.chatCtx.transcriptPath);
        this.markSeen(unseen);
        return;
      }

      await finalizeInboundTurn({
        chatCtx: this.chatCtx,
        config: this.config,
        chatName,
        isGroupChat,
        unseen,
        userLines: turnResult.userLines,
        sentTexts: turnResult.sentTexts,
        groupPolicy,
        groupBuffers: this.groupBuffers,
        escalation: this.escalation,
        lastTriageConfidence: this.lastTriageConfidence,
      });
      this.transcriptEntries = loadTranscript(this.chatCtx.transcriptPath);
      this.agent.state.messages = [];

      this.markSeen(unseen);
    } finally {
      this.lastTriageConfidence = undefined;
      this.busy = false;
      this.replyMentionsRef.current = undefined;
      this.pendingAudiosRef.current = [];
      this.pendingVoiceCaptionRef.current = false;
    }
  }
}

export class SessionManager {
  private sessions = new Map<string, ChatSession>();
  private groupBuffers = new Map<string, Message[]>();
  private maintainerSeen = new Map<string, SeenStore>();

  constructor(
    private client: WeChatClient,
    private config: PiWeChatConfig,
    private escalation?: EscalationService,
  ) {}

  /** 供 inbound worker fast-discard 写入群缓冲（与 ChatSession 共享）。 */
  getGroupBuffers(): Map<string, Message[]> {
    return this.groupBuffers;
  }

  getEscalation(): EscalationService | undefined {
    return this.escalation;
  }

  isMaintainerChat(chatId: string): boolean {
    return this.escalation?.isMaintainerChat(chatId) ?? false;
  }

  async processMaintainer(chatId: string): Promise<void> {
    if (!this.escalation?.isEnabled()) return;

    const chatCtx = ensureChatContext(chatId);
    let seen = this.maintainerSeen.get(chatId);
    if (!seen) {
      seen = new SeenStore(chatCtx.seenPath, chatId);
      this.maintainerSeen.set(chatId, seen);
    }

    const messages = await this.client.listMessages(chatId, 20);
    const unseen = messages.filter(
      (m) => !m.isSelf && !seen!.has(messageKey(m.localId)),
    );
    if (unseen.length === 0) return;

    for (const msg of unseen) {
      const text = msg.content?.trim() ?? "";
      if (text) {
        await this.escalation.handleMaintainerMessage(text);
      }
      seen.add(messageKey(msg.localId));
    }
    seen.persist();
  }

  get(chatId: string): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      const chatCtx = ensureChatContext(chatId);
      session = new ChatSession(
        this.client,
        chatCtx,
        this.config,
        this.groupBuffers,
        this.escalation,
      );
      this.sessions.set(chatId, session);
    }
    return session;
  }
}
