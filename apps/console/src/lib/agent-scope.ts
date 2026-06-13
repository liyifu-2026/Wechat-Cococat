import {
  buildAgentScopePayload,
  type AgentScopePayload,
  AGENT_SCOPE_VERSION,
  MAX_PATH_HINTS,
  MAX_PURPOSE_CHARS,
  MAX_TAGS,
  extractPurposeFromOverview,
  extractTagsAndPathHints,
} from "@cococat/shared/agent-scope"
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { getCococatPaths } from "@/lib/agent-config-client"
import { normalizePath } from "@/lib/path-utils"
import { ensureProjectId } from "@/lib/project-identity"

export {
  AGENT_SCOPE_VERSION,
  MAX_PATH_HINTS,
  MAX_PURPOSE_CHARS,
  MAX_TAGS,
  buildAgentScopePayload,
  extractPurposeFromOverview,
  extractTagsAndPathHints,
  type AgentScopePayload,
}

async function tryRead(relPath: string): Promise<string> {
  try {
    return await readFile(relPath)
  } catch {
    return ""
  }
}

export async function generateAgentScope(
  projectPath: string,
): Promise<AgentScopePayload | null> {
  const pp = normalizePath(projectPath)
  const [overview, purposeMd, indexContent, projectId, paths] = await Promise.all([
    tryRead(`${pp}/wiki/overview.md`),
    tryRead(`${pp}/purpose.md`),
    tryRead(`${pp}/wiki/index.md`),
    ensureProjectId(pp),
    getCococatPaths(),
  ])

  if (!indexContent.trim() && !overview.trim() && !purposeMd.trim()) {
    return null
  }

  const payload = buildAgentScopePayload({
    overview: overview || undefined,
    purposeMd: purposeMd || undefined,
    indexContent,
    source: "ingest-rules",
  })

  const json = `${JSON.stringify(payload, null, 2)}\n`
  const projectScopePath = normalizePath(`${pp}/.llm-wiki/agent-scope.json`)
  const sharedScopePath = normalizePath(
    `${paths.data_dir}/wiki-scope/${projectId}.json`,
  )

  await createDirectory(normalizePath(`${pp}/.llm-wiki`))
  await createDirectory(normalizePath(`${paths.data_dir}/wiki-scope`))
  await Promise.all([
    writeFileAtomic(projectScopePath, json),
    writeFileAtomic(sharedScopePath, json),
  ])

  return payload
}
