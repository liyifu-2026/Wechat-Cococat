import { invoke } from "@tauri-apps/api/core"
import { ensureAndBindAgentChatDir } from "@/lib/agent-config-client"
import {
  listAllRegisteredWikiAliases,
  resolveInboxChatWikiProjects,
} from "@/lib/resolve-inbox-chat-wiki"

/** Customer type id for escalation maintainers — binds all registered wikis. */
export const MAINTAINER_CUSTOMER_TYPE_ID = "maintainer"

const MAINTAINER_TYPE_ENTRY: CustomerTypeEntry = {
  id: MAINTAINER_CUSTOMER_TYPE_ID,
  label: "维护人",
  description: "内部运维账号，可检索全部已注册知识库",
  wikiProjects: [],
  sortOrder: -1,
}

export type CustomerTypeEntry = {
  id: string
  label: string
  description?: string
  wikiProjects: string[]
  behaviorGuide?: string
  sortOrder?: number
}

export type CustomerTypesConfig = {
  types: CustomerTypeEntry[]
}

export async function readCustomerTypesConfig(): Promise<CustomerTypesConfig> {
  const raw = await invoke<{ types?: CustomerTypeEntry[] }>(
    "read_customer_types_config",
  )
  return {
    types: (raw.types ?? []).map(normalizeEntry),
  }
}

export async function writeCustomerTypesConfig(
  config: CustomerTypesConfig,
): Promise<void> {
  await invoke("write_customer_types_config", {
    file: {
      types: config.types.map(normalizeEntry),
    },
  })
}

function normalizeEntry(entry: CustomerTypeEntry): CustomerTypeEntry {
  return {
    id: entry.id.trim(),
    label: entry.label.trim(),
    description: entry.description?.trim() ?? "",
    wikiProjects: entry.wikiProjects
      .map((a) => a.trim())
      .filter(Boolean),
    behaviorGuide: entry.behaviorGuide?.trim() ?? "",
    sortOrder: entry.sortOrder ?? 0,
  }
}

export type ApplyTypePresetWikiResult =
  | {
      ok: true
      boundAliases: string[]
      skippedInvalid: string[]
      partial: boolean
    }
  | {
      ok: false
      reason: "empty_preset" | "all_invalid"
      skippedInvalid: string[]
    }

/** Resolve preset aliases and bind only still-valid projects. */
export async function applyTypePresetWiki(
  chatId: string,
  wikiProjects: string[],
): Promise<ApplyTypePresetWikiResult> {
  const preset = wikiProjects.map((a) => a.trim()).filter(Boolean)
  if (preset.length === 0) {
    return { ok: false, reason: "empty_preset", skippedInvalid: [] }
  }

  const resolved = await resolveInboxChatWikiProjects(preset)
  if (resolved.resolved.length === 0) {
    return {
      ok: false,
      reason: "all_invalid",
      skippedInvalid: resolved.invalidAliases,
    }
  }

  const aliases = resolved.resolved.map((p) => p.alias)
  await ensureAndBindAgentChatDir(
    chatId,
    JSON.stringify({ projects: aliases }, null, 2) + "\n",
  )

  return {
    ok: true,
    boundAliases: aliases,
    skippedInvalid: resolved.invalidAliases,
    partial: resolved.invalidAliases.length > 0,
  }
}

export function findCustomerType(
  config: CustomerTypesConfig,
  userType: string | null | undefined,
): CustomerTypeEntry | undefined {
  if (!userType?.trim()) return undefined
  return config.types.find((t) => t.id === userType)
}

/** Bind every registered wiki alias to a chat (maintainer / ops accounts). */
export async function applyAllRegisteredWikiToChat(
  chatId: string,
): Promise<ApplyTypePresetWikiResult> {
  const aliases = await listAllRegisteredWikiAliases()
  if (aliases.length === 0) {
    return { ok: false, reason: "empty_preset", skippedInvalid: [] }
  }
  return applyTypePresetWiki(chatId, aliases)
}

/** Ensure built-in maintainer customer type exists in customer-types.json. */
export async function ensureMaintainerCustomerType(): Promise<void> {
  const config = await readCustomerTypesConfig()
  if (config.types.some((t) => t.id === MAINTAINER_CUSTOMER_TYPE_ID)) return
  await writeCustomerTypesConfig({
    types: [MAINTAINER_TYPE_ENTRY, ...config.types],
  })
}
