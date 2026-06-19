import type { AgentHandoffTurnRef } from "./escalation/agent-handoff.js";
import type { MimoAudioInput } from "./mimo-audio.js";

export type MutableRef<T> = { current: T };

export class TurnRuntime {
  readonly sendCountRef: MutableRef<number> = { current: 0 };
  readonly sentTextsRef: MutableRef<string[]> = { current: [] };
  readonly replyMentionsRef: MutableRef<string[] | undefined> = {
    current: undefined,
  };
  readonly pendingAudiosRef: MutableRef<MimoAudioInput[]> = { current: [] };
  readonly pendingVoiceCaptionRef: MutableRef<boolean> = { current: false };
  readonly pendingSystemRef: MutableRef<string> = { current: "" };
  readonly gatherBlockSendRef: MutableRef<boolean> = { current: false };
  readonly stealthRetriedRef: MutableRef<boolean> = { current: false };
  readonly handoffTurnRef: AgentHandoffTurnRef = {
    chatName: "",
    userLines: [],
    done: false,
  };

  currentTurnId?: string;
  lastTriageConfidence?: number;

  resetOutbound(): void {
    this.sendCountRef.current = 0;
    this.sentTextsRef.current = [];
    this.stealthRetriedRef.current = false;
  }

  startTurn(params: {
    chatName: string;
    turnId: string;
    userLines?: string[];
  }): void {
    this.currentTurnId = params.turnId;
    this.stealthRetriedRef.current = false;
    this.handoffTurnRef.chatName = params.chatName;
    this.handoffTurnRef.userLines = params.userLines ?? [];
    this.handoffTurnRef.turnId = params.turnId;
    this.handoffTurnRef.done = false;
  }

  clearInboundScratch(): void {
    this.lastTriageConfidence = undefined;
    this.replyMentionsRef.current = undefined;
    this.pendingAudiosRef.current = [];
    this.pendingVoiceCaptionRef.current = false;
  }

  clearOutboundScratch(): void {
    this.replyMentionsRef.current = undefined;
    this.pendingAudiosRef.current = [];
    this.pendingVoiceCaptionRef.current = false;
  }
}
