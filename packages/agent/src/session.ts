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
import { reconcileTranscriptForChat } from "./reconcile-transcript.js";
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
import { createAgentHandoffTools } from "./escalation/agent-handoff.js";
import { isQueueEnabled } from "./queue/redis.js";
import { cancelPendingOutboundForChat } from "./queue/cancel-pending-outbound.js";
import { createScheduleTools } from "./schedule-tools.js";
import { createContactProfileTools } from "./contact-profile-tools.js";
import { resolveCustomerContextPrompt } from "./customer-context-prompt.js";
import { applyPayloadHooks } from "./payload-hooks.js";
import {
  runThoughtfulTurn,
  shouldUseThoughtful,
} from "./thoughtful.js";
import { TurnRuntime } from "./turn-runtime.js";
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

type GateDiscardCtx = {
  chatId: string;
  chatName: string;
  markSeen: (messages: Message[]) => void;
  reconcileTranscript?: () => Promise<void>;
};

async function handleGateDiscard(
  gate: { action: "discard"; reason: string; unseen: Message[]; shouldMarkSeen: boolean },
  ctx: GateDiscardCtx,
): Promise<void> {
  if (gate.reason === "group_buffer") {
    console.log(
      `[pi-wechat] ${ctx.chatName}: buffered ${gate.unseen.length} group message(s) (mention required)`,
    );
    appendAgentTrace({
      chatId: ctx.chatId,
      chatName: ctx.chatName,
      turnId: createTurnId(
        ctx.chatId,
        gate.unseen.map((m) => m.localId),
      ),
      phase: "buffer",
      query: `+${gate.unseen.length} 条入 buffer`,
      detail: gate.unseen
        .map((m) => m.content?.trim() || `localId=${m.localId}`)
        .join("\n"),
    });
  } else if (gate.reason === "triage_done") {
    const previewLines = gate.unseen
      .map((m) => m.content?.trim() ?? "")
      .filter(Boolean);
    appendAgentTrace({
      chatId: ctx.chatId,
      chatName: ctx.chatName,
      turnId: createTurnId(
        ctx.chatId,
        gate.unseen.map((m) => m.localId),
      ),
      phase: "triage",
      query: "done",
      detail: previewLines.join("\n") || "(空)",
    });
  } else if (gate.reason === "memory_unavailable") {
    console.warn(
      `[pi-wechat] ${ctx.chatName}: Memory unavailable — suspend (no markSeen)`,
    );
    appendAgentTrace({
      chatId: ctx.chatId,
      chatName: ctx.chatName,
      turnId: createTurnId(
        ctx.chatId,
        gate.unseen.map((m) => m.localId),
      ),
      phase: "skip",
      query: "memory_unavailable",
      detail: "await retry",
    });
  } else if (gate.reason === "agent_proxy_off") {
    console.log(
      `[pi-wechat] ${ctx.chatName}: agent proxy off — observe-only (${gate.unseen.length} msg)`,
    );
    appendAgentTrace({
      chatId: ctx.chatId,
      chatName: ctx.chatName,
      turnId: createTurnId(
        ctx.chatId,
        gate.unseen.map((m) => m.localId),
      ),
      phase: "skip",
      query: "agent_proxy_off",
      detail: gate.unseen
        .map((m) => m.content?.trim() || `localId=${m.localId}`)
        .join("\n"),
    });
  }
  if (gate.shouldMarkSeen) {
    ctx.markSeen(gate.unseen);
  }
  if (gate.reason === "agent_proxy_off") {
    try {
      await ctx.reconcileTranscript?.();
    } catch (err) {
      console.warn(
        `[pi-wechat] ${ctx.chatName}: reconcile after agent_proxy_off failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function logModelOutput(
  agent: Agent,
  chatId: string,
  turnId: string | undefined,
  chatName?: string,
): void {
  const thinking = extractAllThinking(agent);
  if (thinking) {
    appendAgentTrace({ chatId, chatName, turnId, phase: "thinking", detail: thinking });
  }
  const draft = extractAssistantDraft(agent);
  if (draft) {
    appendAgentTrace({ chatId, chatName, turnId, phase: "compose", detail: draft });
  }
}

async function executePromptTurn(
  deps: {
    agent: Agent;
    client: WeChatClient;
    chatId: string;
    style: ChatContext["style"];
    turn: TurnRuntime;
    queueEnabled: boolean;
  },
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
    shouldUseThoughtful(deps.style, opts.userLines);

  if (useThoughtful && deps.queueEnabled && !opts.inlineThoughtfulOk) {
    throw new Error(
      "[pi-wechat] thoughtful must run on outbound queue when enabled",
    );
  }

  if (useThoughtful) {
    const thoughtful = await runThoughtfulTurn({
      agent: deps.agent,
      client: deps.client,
      chatId: deps.chatId,
      chatName: opts.chatName,
      turnId: deps.turn.currentTurnId,
      style: deps.style,
      userPrompt: prompt,
      images,
      gatherBlockSendRef: deps.turn.gatherBlockSendRef,
      sendCountRef: deps.turn.sendCountRef,
    });
    logModelOutput(deps.agent, deps.chatId, deps.turn.currentTurnId, opts.chatName);
    stripReasoningFromAgent(deps.agent);
    if (thoughtful.ackLine) {
      deps.turn.sentTextsRef.current.push(thoughtful.ackLine);
    }
    return;
  }

  if (images.length > 0) {
    await deps.agent.prompt(prompt, images);
  } else {
    await deps.agent.prompt(prompt);
  }
  logModelOutput(deps.agent, deps.chatId, deps.turn.currentTurnId, opts.chatName);
}

export class ChatSession {
  private agent: Agent;
  private readonly turn = new TurnRuntime();
  private busy = false;
  private workQueue: Promise<void> = Promise.resolve();
  private transcriptLoaded = false;
  private transcriptEntries: TranscriptEntry[] = [];
  private seenStore: SeenStore;
  private maxSendsPerTurn: number;

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
      sendCountRef: this.turn.sendCountRef,
      sentTextsRef: this.turn.sentTextsRef,
      burstDelayMs: chatCtx.style.burstDelayMs,
      replyMentionsRef: this.turn.replyMentionsRef,
      maxSendsPerTurn: this.maxSendsPerTurn,
      stealthRetriedRef: this.turn.stealthRetriedRef,
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

    const isPrivateService =
      !chatCtx.chatId.includes("@chatroom") &&
      isServicePersona(chatCtx.style) &&
      escalation?.isAgentHandoffEnabled();
    if (isPrivateService && escalation) {
      extraTools.push(
        ...createAgentHandoffTools(
          escalation,
          chatCtx.chatId,
          this.turn.handoffTurnRef,
        ),
      );
    }

    if (isPrivateService) {
      extraTools.push(
        ...createContactProfileTools({ chatId: chatCtx.chatId }),
      );
    }

    if (isQueueEnabled()) {
      extraTools.push(...createScheduleTools({ chatId: chatCtx.chatId }));
    }

    const tools = wrapToolsWithTrace([...baseTools, ...extraTools], {
      chatId: chatCtx.chatId,
      getTurnId: () => this.turn.currentTurnId,
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
        if (this.turn.gatherBlockSendRef.current) {
          return {
            block: true,
            reason: "调研阶段不可发微信，请先整理要点。",
          };
        }
        if (this.turn.handoffTurnRef.done) {
          return {
            block: true,
            reason: "本会话已转同事跟进，勿再发微信。",
          };
        }
        if (this.turn.sendCountRef.current >= this.maxSendsPerTurn) {
          return {
            block: true,
            reason: `每轮最多 ${this.maxSendsPerTurn} 条微信。`,
          };
        }
        if (this.turn.sendCountRef.current === 0) {
          await applyDelay(this.chatCtx.style.replyDelayMs);
        }
        if (
          isServicePersona(this.chatCtx.style) &&
          ctx.toolCall.name === "wechat_send_message"
        ) {
          const raw = (ctx.toolCall.arguments as { text?: string })?.text ?? "";
          const prepared = prepareServiceOutboundText(
            raw,
            this.turn.stealthRetriedRef,
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
          this.turn.pendingSystemRef.current,
          this.turn.pendingAudiosRef.current,
          this.turn.pendingVoiceCaptionRef.current,
        );
        this.turn.pendingAudiosRef.current = [];
        return next;
      },
      onResponse: async () => {
        stripReasoningFromAgent(this.agent);
      },
    });
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.workQueue.then(fn, fn);
    this.workQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
    await this.runExclusive(async () => {
      this.seenStore.reload();
      const messages = await this.client.listMessages(this.chatCtx.chatId, 40);
      const unseen = messages.filter(
        (m) => !m.isSelf && !this.seenStore.has(messageKey(m.localId)),
      );
      if (unseen.length === 0) return;
      await this.processUnseen(chatName, isGroup, unseen);
    });
  }

  async processSnapshot(
    chatName: string,
    isGroup: boolean,
    snapshotLocalIds: number[],
  ): Promise<void> {
    await this.runExclusive(async () => {
      this.seenStore.reload();
      const idSet = new Set(snapshotLocalIds);
      const messages = await this.client.listMessages(this.chatCtx.chatId, 40);
      const snapshotMsgs = messages.filter(
        (m) => !m.isSelf && idSet.has(m.localId),
      );
      let unseen = snapshotMsgs.filter(
        (m) => !this.seenStore.has(messageKey(m.localId)),
      );
      // snapshot localId 在窗口里找不到时，才回退到「任意未 seen」
      if (unseen.length === 0 && snapshotMsgs.length === 0) {
        unseen = messages.filter(
          (m) =>
            !m.isSelf && !this.seenStore.has(messageKey(m.localId)),
        );
      }
      if (unseen.length === 0) return;
      await this.processUnseen(chatName, isGroup, unseen);
    });
  }

  async runProactiveTurn(params: {
    chatName: string;
    isGroup: boolean;
    systemPrompt?: string;
    thoughtful?: boolean;
  }): Promise<void> {
    await this.runExclusive(async () => {
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

      this.turn.pendingSystemRef.current = buildSystemPrompt({
        chatId: this.chatCtx.chatId,
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
        customerContextPrompt: isGroupChat
          ? ""
          : resolveCustomerContextPrompt(this.chatCtx.chatId),
      });

      this.turn.resetOutbound();

      await executePromptTurn({
        agent: this.agent,
        client: this.client,
        chatId: this.chatCtx.chatId,
        style: this.chatCtx.style,
        turn: this.turn,
        queueEnabled: this.config.queueEnabled,
      }, taskLine, [], {
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
        this.turn.sendCountRef.current,
        undefined,
        this.chatCtx.style.burstDelayMs,
        this.maxSendsPerTurn,
        {
          serviceStealthEnabled: isServicePersona(this.chatCtx.style),
          stealthRetriedRef: this.turn.stealthRetriedRef,
        },
      );
      this.turn.sentTextsRef.current.push(...fallbackSent);
      this.traceReplySummary(params.chatName);

      finalizeProactiveTurn({
        chatCtx: this.chatCtx,
        sentTexts: this.turn.sentTextsRef.current,
      });
      } finally {
        this.busy = false;
        this.agent.state.messages = [];
      }
    });
  }

  /** outbound 队列：入站 thoughtful 两阶段回复（Gather→Compose→发送）。 */
  async runInboundThoughtfulReply(params: {
    chatName: string;
    isGroup: boolean;
    userLocalIds: number[];
    replyMentions?: string[];
  }): Promise<void> {
    await this.runExclusive(async () => {
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

      const turnId = createTurnId(this.chatCtx.chatId, params.userLocalIds);
      this.turn.startTurn({
        chatName: params.chatName,
        turnId,
      });

      const agentHandoffEnabled =
        !isGroupChat &&
        isServicePersona(this.chatCtx.style) &&
        (this.escalation?.isAgentHandoffEnabled() ?? false);

      const { userLines, sentTexts } = await runThoughtfulInboundTurn({
        client: this.client,
        config: this.config,
        chatCtx: this.chatCtx,
        agent: this.agent,
        chatName: params.chatName,
        isGroupChat,
        unseen,
        turnId,
        replyMentions: params.replyMentions,
        maxSendsPerTurn: this.maxSendsPerTurn,
        turn: this.turn,
        agentHandoffEnabled,
        runThoughtfulTurn: async (prompt, images) => {
          const thoughtful = await runThoughtfulTurn({
            agent: this.agent,
            client: this.client,
            chatId: this.chatCtx.chatId,
            chatName: params.chatName,
            turnId,
            style: this.chatCtx.style,
            userPrompt: prompt,
            images,
            gatherBlockSendRef: this.turn.gatherBlockSendRef,
            sendCountRef: this.turn.sendCountRef,
          });
          this.traceModelOutput(params.chatName);
          if (thoughtful.ackLine) {
            this.turn.sentTextsRef.current.push(thoughtful.ackLine);
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
        lastTriageConfidence: this.turn.lastTriageConfidence,
        assistantOnlyTranscript: true,
      });
      this.transcriptEntries = loadTranscript(this.chatCtx.transcriptPath);
      this.agent.state.messages = [];

      console.log(
        `[pi-wechat] ${params.chatName}: outbound thoughtful complete (${this.turn.sentTextsRef.current.length} send(s))`,
      );
      } finally {
        this.busy = false;
        this.turn.clearOutboundScratch();
      }
    });
  }

  private traceModelOutput(chatName?: string): void {
    logModelOutput(this.agent, this.chatCtx.chatId, this.turn.currentTurnId, chatName);
  }

  private traceReplySummary(chatName?: string): void {
    if (this.turn.sentTextsRef.current.length === 0) return;
    appendAgentTrace({
      chatId: this.chatCtx.chatId,
      chatName,
      turnId: this.turn.currentTurnId,
      phase: "reply",
      query: `${this.turn.sentTextsRef.current.length} 条`,
      detail: this.turn.sentTextsRef.current.join("\n---\n"),
    });
  }

  private async processUnseen(
    chatName: string,
    isGroup: boolean,
    unseen: Message[],
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
      });

      if (earlyGate.action === "discard") {
        await handleGateDiscard(earlyGate, {
          chatId: this.chatCtx.chatId,
          chatName,
          markSeen: (msgs) => this.markSeen(msgs),
          reconcileTranscript: async () => {
            await reconcileTranscriptForChat(
              this.client,
              this.chatCtx.chatId,
              this.chatCtx.style.historyLimit,
            );
          },
        });
        return;
      }

      unseen = earlyGate.unseen;
      const { wasMentioned, groupPolicy, injectedBufferCount } = earlyGate;
      this.turn.lastTriageConfidence = earlyGate.lastTriageConfidence;

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

      const turnId = createTurnId(
        this.chatCtx.chatId,
        unseen.map((m) => m.localId),
      );
      this.turn.startTurn({
        chatName,
        turnId,
      });

      const agentHandoffEnabled =
        !isGroupChat &&
        isServicePersona(this.chatCtx.style) &&
        (this.escalation?.isAgentHandoffEnabled() ?? false);

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
        turnId,
        groupBuffers: this.groupBuffers,
        maxSendsPerTurn: this.maxSendsPerTurn,
        turn: this.turn,
        agentHandoffEnabled,
        runPromptTurn: (prompt, images, opts) =>
          executePromptTurn({
            agent: this.agent,
            client: this.client,
            chatId: this.chatCtx.chatId,
            style: this.chatCtx.style,
            turn: this.turn,
            queueEnabled: this.config.queueEnabled,
          }, prompt, images, opts),
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
        lastTriageConfidence: this.turn.lastTriageConfidence,
      });
      this.transcriptEntries = loadTranscript(this.chatCtx.transcriptPath);
      this.agent.state.messages = [];

      this.markSeen(unseen);
    } finally {
      this.busy = false;
      this.turn.clearInboundScratch();
    }
  }
}

export class SessionManager {
  private sessions = new Map<string, ChatSession>();
  private groupBuffers = new Map<string, Message[]>();
  private maintainerSeen = new Map<string, SeenStore>();

  private pruneSessions(): void {
    const maxSessions = 500;
    while (this.sessions.size > maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
  }

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

    const chatName =
      this.escalation.config.maintainerDisplayName.trim() || "维护者";
    const ctx = {
      wikiEnabled: this.config.wikiEnabled,
      wikiClient: this.config.wikiClient,
      memoryClient: this.config.memoryClient,
    };

    const forAgent: number[] = [];

    for (const msg of unseen) {
      const text = msg.content?.trim() ?? "";
      let handledByMaintainerCommand = true;
      if (text) {
        const outcome = await this.escalation.handleMaintainerMessage(
          chatId,
          text,
          ctx,
        );
        if (outcome === "chat") {
          forAgent.push(msg.localId);
          handledByMaintainerCommand = false;
        }
      }
      if (handledByMaintainerCommand) {
        seen.add(messageKey(msg.localId));
      }
    }
    seen.persist();

    if (forAgent.length === 0) return;

    await this.get(chatId).processSnapshot(chatName, false, forAgent);
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
      this.pruneSessions();
    }
    return session;
  }
}
