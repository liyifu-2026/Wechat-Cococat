import { readChatPersona } from "./persona.js";
import { DISCIPLINE_LAYER } from "./discipline.js";
import { WIKI_SYSTEM_PROMPT_APPEND } from "./prompt.js";
import { AGENT_HANDOFF_PROMPT } from "./escalation/agent-handoff.js";
import { loadWikiRegistry, type WikiRegistry } from "./wiki-registry.js";
import { wikiContextManager } from "./wiki-context.js";

export type SystemPromptContext = {
  chatName: string;
  isGroup: boolean;
  personaPath: string;
  envOverride?: string;
  wikiEnabled: boolean;
  /** 动态知识库范围块；缺省时 wikiEnabled 仍回退静态 append */
  wikiScopePrompt?: string;
  longTermMemory?: string;
  /** 私聊客服 + escalation 启用时注入主动升级说明 */
  agentHandoffEnabled?: boolean;
  /** 人类设定的客户类型与行为指南（每轮实时读取 profile） */
  customerContextPrompt?: string;
};

function sceneLine(chatName: string, isGroup: boolean): string {
  if (isGroup) {
    return `当前：群聊「${chatName}」`;
  }
  return "当前：私聊";
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [DISCIPLINE_LAYER, sceneLine(ctx.chatName, ctx.isGroup)];

  const middle: string[] = [];

  if (ctx.customerContextPrompt?.trim()) {
    middle.push(ctx.customerContextPrompt.trim());
  }

  if (ctx.envOverride?.trim()) {
    middle.push(ctx.envOverride.trim());
  } else {
    if (ctx.longTermMemory?.trim()) {
      middle.push(`【长期记忆】\n${ctx.longTermMemory.trim()}`);
    }
    middle.push(readChatPersona(ctx.personaPath));
    if (ctx.wikiEnabled) {
      const wikiBlock =
        ctx.wikiScopePrompt?.trim() || WIKI_SYSTEM_PROMPT_APPEND.trim();
      middle.push(wikiBlock);
    }
    if (ctx.agentHandoffEnabled) {
      middle.push(AGENT_HANDOFF_PROMPT);
    }
  }

  parts.push(...middle.filter((p) => p.length > 0));
  return parts.join("\n\n");
}

export function resolveWikiScopePrompt(
  wikiEnabled: boolean,
  wikiProjects: string[] | undefined,
  registry?: WikiRegistry,
): string {
  if (!wikiEnabled) return "";
  const aliases = wikiProjects?.filter(Boolean) ?? [];
  if (aliases.length === 0) return "";
  const reg = registry ?? loadWikiRegistry();
  return wikiContextManager.buildScopePrompt(aliases, reg);
}
