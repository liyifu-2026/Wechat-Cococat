import { listActiveMutes } from "./state-store.js";
import type { MuteReason } from "./types.js";
import {
  formatWechatText,
  shortChatId,
} from "./wechat-line-wrap.js";

function stripInternalReason(reason: string): string {
  const trimmed = reason.trim();
  const at = trimmed.lastIndexOf("@");
  if (at > 0) return trimmed.slice(0, at).trim();
  return trimmed;
}

function lastUserLine(userLines: string[]): string {
  return userLines.map((l) => l.trim()).filter(Boolean).at(-1) ?? "（无文字）";
}

function earlierUserLines(userLines: string[], max = 2): string[] {
  const nonEmpty = userLines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length <= 1) return [];
  return nonEmpty.slice(-(max + 1), -1);
}

function muteTag(reason: MuteReason): string {
  return reason === "escalate_a" ? "转人工" : "试探";
}

function triggerTypeLabel(trigger: string): string {
  if (trigger === "probe_b") return "试探升级";
  if (trigger === "escalate_a") return "转人工";
  return trigger;
}

export function formatEscalationAlert(params: {
  chatName: string;
  chatId: string;
  trigger: string;
  reason: string;
  userLines: string[];
  muteHours: number;
}): string {
  const detail = stripInternalReason(params.reason);
  const lines: string[] = [
    "【需处理】",
    `客户:${params.chatName}`,
    `刚说:${lastUserLine(params.userLines)}`,
    ...earlierUserLines(params.userLines).map((l) => `还说:${l}`),
    `类型:${triggerTypeLabel(params.trigger)}`,
  ];
  if (detail && detail.length > 0) {
    lines.push(`详情:${detail}`);
  }
  lines.push("客户侧静默");
  lines.push(`mute${params.muteHours}小时`);
  lines.push(`id:${shortChatId(params.chatId)}`);
  return formatWechatText(lines);
}

export function formatAgentHandoffAlert(params: {
  chatName: string;
  chatId: string;
  reason: string;
  summary: string;
  userLines: string[];
  muteHours: number;
}): string {
  const lines: string[] = [
    "【Agent升级】",
    `客户:${params.chatName}`,
    `刚说:${lastUserLine(params.userLines)}`,
    ...earlierUserLines(params.userLines).map((l) => `还说:${l}`),
    `分类:${stripInternalReason(params.reason)}`,
    `摘要:${params.summary.trim()}`,
    "客户侧静默",
    `mute${params.muteHours}小时`,
    `id:${shortChatId(params.chatId)}`,
  ];
  return formatWechatText(lines);
}

export function formatLowConfidenceFyi(params: {
  chatName: string;
  chatId: string;
  confidence: number;
  threshold: number;
  userLines: string[];
}): string {
  const lines: string[] = [
    "【低置信】",
    `客户:${params.chatName}`,
    `刚说:${lastUserLine(params.userLines)}`,
    `置信:${params.confidence.toFixed(2)}`,
    `阈值:${params.threshold.toFixed(2)}`,
    "已自动回复",
    "请留意跟进",
    `id:${shortChatId(params.chatId)}`,
  ];
  return formatWechatText(lines);
}

export function formatMuteListMessage(): string {
  const mutes = listActiveMutes();
  if (mutes.length === 0) {
    return formatWechatText(["【mute列表】", "当前无待办"]);
  }

  const lines: string[] = [`【mute列表】${mutes.length}人`];
  for (let i = 0; i < mutes.length; i++) {
    const m = mutes[i]!;
    const leftMs = m.mutedUntil - Date.now();
    const leftH = Math.max(0, Math.ceil(leftMs / (60 * 60 * 1000)));
    const tag = muteTag(m.reason);
    lines.push(`${i + 1}.${m.chatName}·${tag}`);
    lines.push(`剩${leftH}小时`);
    if (m.lastUserLine?.trim()) {
      lines.push(`说:${m.lastUserLine.trim()}`);
    }
  }
  return formatWechatText(lines);
}

export function formatUnmutePickPrompt(muteCount: number): string {
  const list = formatMuteListMessage();
  return formatWechatText([
    `${muteCount}人待解除`,
    "回序号或名字",
    "---",
    ...list.split("\n"),
  ]);
}

export function formatUnmuteDone(chatName: string): string {
  return formatWechatText([`已恢复:${chatName}`, "可自动回复"]);
}

export function formatNoMutesToClear(): string {
  return formatWechatText(["当前无mute", "无需解除"]);
}

/** 多维护人状态变更广播（全员） */
export function formatMaintainerActionBroadcast(
  operatorName: string,
  detail: string,
): string {
  return formatWechatText([`「${operatorName}」${detail}`]);
}
