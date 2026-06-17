import { listActiveMutes } from "./state-store.js";
import { formatWechatText } from "./wechat-line-wrap.js";

export type MaintainerMenuOptions = {
  wikiEnabled: boolean;
  pendingHint?: string;
};

export function formatMaintainerMenu(opts: MaintainerMenuOptions): string {
  const mutes = listActiveMutes();
  const lines: string[] = ["【维护菜单】"];

  if (mutes.length === 0) {
    lines.push("无待办可聊天");
  } else {
    lines.push(`待办${mutes.length}人先列表`);
  }

  lines.push("列表·看客户");
  lines.push("已处理·解除");
  lines.push("菜单·本帮助");
  lines.push("记忆·查客户");

  if (opts.wikiEnabled) {
    lines.push("搜·关键词");
    lines.push("读·词条路径");
    lines.push("scope·范围");
  }

  if (opts.pendingHint) {
    lines.push(opts.pendingHint);
  }

  return formatWechatText(lines);
}

export function formatMaintainerBlockedChat(muteCount: number): string {
  return formatWechatText([
    `还有${muteCount}人mute`,
    "先：列表",
    "再：已处理",
    "菜单看指令",
    "搞定再聊天",
  ]);
}
