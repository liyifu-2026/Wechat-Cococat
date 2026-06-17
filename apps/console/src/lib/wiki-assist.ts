import { readFile } from "@/commands/fs"
import type { MessageReference } from "@/stores/chat-store"
import { computeContextBudget } from "@/lib/context-budget"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { normalizePath, getRelativePath } from "@/lib/path-utils"
import { searchWiki } from "@/lib/search"
import type { ChatMessage as LLMMessage } from "@/lib/llm-client"
import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import { anyTxtSearchSmart } from "@/lib/anytxt-search"
import { resolveSearchConfig, webSearch, type WebSearchResult } from "@/lib/web-search"
import {
  formatMultiProjectLabel,
  splitLibraryBudgets,
  type WikiAssistProject,
} from "@/lib/wiki-assist-interleave"

export type { WikiAssistProject } from "@/lib/wiki-assist-interleave"

export let lastQueryPages: { title: string; path: string }[] = []

type PageCandidate = { title: string; filePath: string; priority: number }

type LoadedPage = {
  title: string
  path: string
  content: string
  projectName: string
  projectPath: string
}

function toWikiMessageReference(page: LoadedPage): MessageReference {
  return {
    title: page.title,
    path: page.path,
    relPath: getRelativePath(page.path, page.projectPath),
    projectPath: page.projectPath,
    projectName: page.projectName,
    kind: "wiki",
  }
}

function formatExternalSearchContext(results: WebSearchResult[]): string {
  if (results.length === 0) return ""
  return results
    .map((result, index) =>
      [
        `### [E${index + 1}] ${result.title}`,
        `Source: ${result.source}`,
        `URL: ${result.url}`,
        "",
        result.snippet,
      ].join("\n"),
    )
    .join("\n\n---\n\n")
}

export type WikiAssistSendOptions = {
  useWebSearch?: boolean
  useAnyTxtSearch?: boolean
}

export type WikiAssistContext = {
  systemMessages: LLMMessage[]
  queryRefs: MessageReference[]
  langReminder?: string
}

export async function buildWikiAssistContext(
  projects: WikiAssistProject | WikiAssistProject[],
  text: string,
  llmConfig: LlmConfig,
  searchApiConfig: SearchApiConfig,
  options: WikiAssistSendOptions = {},
): Promise<WikiAssistContext> {
  const projectList = Array.isArray(projects) ? projects : [projects]
  if (projectList.length === 0) {
    return { systemMessages: [], queryRefs: [] }
  }
  if (projectList.length === 1) {
    return buildSingleLibraryWikiAssistContext(
      projectList[0]!,
      text,
      llmConfig,
      searchApiConfig,
      options,
    )
  }
  return buildMultiLibraryWikiAssistContext(
    projectList,
    text,
    llmConfig,
    searchApiConfig,
    options,
  )
}

async function trimWikiIndex(
  rawIndex: string,
  indexBudget: number,
  query: string,
): Promise<string> {
  if (rawIndex.length <= indexBudget) return rawIndex

  const { tokenizeQuery } = await import("@/lib/search")
  const tokens = tokenizeQuery(query)
  const lines = rawIndex.split("\n")
  const keptLines: string[] = []
  let keptSize = 0

  for (const line of lines) {
    const isHeader = line.startsWith("##")
    const lower = line.toLowerCase()
    const isRelevant = tokens.some((t) => lower.includes(t))

    if (isHeader || isRelevant) {
      if (keptSize + line.length + 1 <= indexBudget) {
        keptLines.push(line)
        keptSize += line.length + 1
      }
    }
  }

  let index = keptLines.join("\n")
  if (index.length < rawIndex.length) {
    index += "\n\n[...index trimmed to relevant entries...]"
  }
  return index
}

function orderSearchCandidates(
  results: Awaited<ReturnType<typeof searchWiki>>,
): PageCandidate[] {
  const titleMatches = results.filter((r) => r.titleMatch)
  const bodyMatches = results.filter((r) => !r.titleMatch)
  return [
    ...titleMatches.map((r) => ({ title: r.title, filePath: r.path, priority: 0 })),
    ...bodyMatches.map((r) => ({ title: r.title, filePath: r.path, priority: 1 })),
  ]
}

async function collectInterleavedPages(
  libraries: Array<{
    project: WikiAssistProject
    perLibPageBudget: number
    candidates: PageCandidate[]
  }>,
  totalPageBudget: number,
  maxPageSize: number,
): Promise<LoadedPage[]> {
  const nextIndex = libraries.map(() => 0)
  const usedPerLib = libraries.map(() => 0)
  const picked: LoadedPage[] = []
  let totalUsed = 0

  while (totalUsed < totalPageBudget) {
    let progressed = false

    for (let libIdx = 0; libIdx < libraries.length; libIdx++) {
      if (totalUsed >= totalPageBudget) break
      if (usedPerLib[libIdx]! >= libraries[libIdx]!.perLibPageBudget) continue

      const queue = libraries[libIdx]!.candidates
      let idx = nextIndex[libIdx]!
      while (idx < queue.length) {
        const candidate = queue[idx]!
        idx += 1
        nextIndex[libIdx] = idx

        const project = libraries[libIdx]!.project
        const pp = normalizePath(project.projectPath)
        let raw: string
        try {
          raw = await readFile(candidate.filePath)
        } catch {
          continue
        }

        let content =
          raw.length > maxPageSize
            ? raw.slice(0, maxPageSize) + "\n\n[...truncated...]"
            : raw

        let size = content.length
        const libRemaining =
          libraries[libIdx]!.perLibPageBudget - usedPerLib[libIdx]!
        if (size > libRemaining) {
          content = content.slice(0, libRemaining)
          size = content.length
        }
        const totalRemaining = totalPageBudget - totalUsed
        if (size > totalRemaining) {
          content = content.slice(0, totalRemaining)
          size = content.length
        }
        if (size <= 0) continue

        const relativePath = getRelativePath(candidate.filePath, pp)
        picked.push({
          title: candidate.title,
          path: `${pp}/${relativePath.replace(/^\//, "")}`,
          content,
          projectName: project.projectName,
          projectPath: pp,
        })
        usedPerLib[libIdx]! += size
        totalUsed += size
        progressed = true
        break
      }
    }

    if (!progressed) break
  }

  return picked
}

async function loadExternalSearchResults(
  text: string,
  searchApiConfig: SearchApiConfig,
  llmConfig: LlmConfig,
  anyTxtProjectPath: string,
  options: WikiAssistSendOptions,
): Promise<{ results: WebSearchResult[]; errors: string[] }> {
  const resolvedExternalSearchConfig = resolveSearchConfig(searchApiConfig)
  const externalSearchResults: WebSearchResult[] = []
  const externalSearchErrors: string[] = []
  const externalCalls: Promise<WebSearchResult[]>[] = []

  if (options.useWebSearch) {
    externalCalls.push(
      webSearch(text, resolvedExternalSearchConfig, 5).catch((err) => {
        externalSearchErrors.push(
          `Web Search: ${err instanceof Error ? err.message : String(err)}`,
        )
        return []
      }),
    )
  }

  if (options.useAnyTxtSearch) {
    externalCalls.push(
      anyTxtSearchSmart(
        text,
        resolvedExternalSearchConfig.anyTxt,
        llmConfig,
        5,
        anyTxtProjectPath,
      ).catch((err) => {
        externalSearchErrors.push(
          `AnyTXT: ${err instanceof Error ? err.message : String(err)}`,
        )
        return []
      }),
    )
  }

  if (externalCalls.length > 0) {
    const batches = await Promise.all(externalCalls)
    const seenExternal = new Set<string>()
    for (const result of batches.flat()) {
      const key = result.url || `${result.source}:${result.title}:${result.snippet}`
      if (seenExternal.has(key)) continue
      seenExternal.add(key)
      externalSearchResults.push(result)
      if (externalSearchResults.length >= 10) break
    }
  }

  return { results: externalSearchResults, errors: externalSearchErrors }
}

function assembleSystemPrompt(params: {
  projectLabel: string
  multiLibrary: boolean
  purposeSections: string[]
  indexSections: string[]
  relevantPages: LoadedPage[]
  externalContext: string
  externalSearchErrors: string[]
  outLang: string
}): string {
  const {
    projectLabel,
    multiLibrary,
    purposeSections,
    indexSections,
    relevantPages,
    externalContext,
    externalSearchErrors,
    outLang,
  } = params

  const pagesContext =
    relevantPages.length > 0
      ? relevantPages
          .map((p, i) => {
            const pathLabel = multiLibrary
              ? `${p.projectName}/${getRelativePath(p.path, p.projectPath)}`
              : getRelativePath(p.path, p.projectPath)
            return `### [${i + 1}] ${p.title}\nPath: ${pathLabel}\n\n${p.content}`
          })
          .join("\n\n---\n\n")
      : "(No wiki pages found)"

  const pageList = relevantPages
    .map((p, i) => {
      const pathLabel = multiLibrary
        ? `${p.projectName}/${getRelativePath(p.path, p.projectPath)}`
        : getRelativePath(p.path, p.projectPath)
      return `[${i + 1}] ${p.title} (${pathLabel})`
    })
    .join("\n")

  return [
    multiLibrary
      ? `You are a knowledgeable wiki assistant spanning multiple wiki libraries: ${projectLabel}.`
      : "You are a knowledgeable wiki assistant. Answer questions based on the wiki content provided below.",
    "",
    "## Rules",
    "- Be concise and direct. Prefer short sentences and bullet points over long paragraphs.",
    "- Skip filler, pleasantries, and repetition unless the user asks for detail.",
    externalContext
      ? "- Answer based ONLY on the numbered wiki pages and external sources provided below."
      : "- Answer based ONLY on the numbered wiki pages provided below.",
    "- If the provided pages don't contain enough information, say so honestly.",
    "- Use [[wikilink]] syntax to reference wiki pages.",
    externalContext
      ? "- When citing wiki information, use page numbers like [1], [2]. When citing external information, use external source IDs like [E1], [E2]."
      : "- When citing information, use the page number in brackets, e.g. [1], [2].",
    "- At the VERY END of your response, add a hidden comment listing which page numbers you used:",
    "  <!-- cited: 1, 3, 5 -->",
    "",
    "Use markdown formatting for clarity.",
    "",
    ...purposeSections,
    ...indexSections,
    relevantPages.length > 0 ? `## Page List\n${pageList}` : "",
    `## Wiki Pages\n\n${pagesContext}`,
    externalContext ? `## External Sources\n\n${externalContext}` : "",
    externalSearchErrors.length > 0
      ? `## External Source Errors\n${externalSearchErrors.map((err) => `- ${err}`).join("\n")}`
      : "",
    "",
    "---",
    "",
    `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${outLang}`,
    "",
    `You MUST write your entire response in **${outLang}**.`,
    `The wiki content above may be in a different language, but this is IRRELEVANT to your output language.`,
    `Ignore the language of the wiki content. Write in ${outLang} only.`,
    `Even proper nouns should use standard ${outLang} transliteration when appropriate.`,
    `DO NOT use any other language. This overrides all other instructions.`,
  ]
    .filter(Boolean)
    .join("\n")
}

async function buildSingleLibraryWikiAssistContext(
  project: WikiAssistProject,
  text: string,
  llmConfig: LlmConfig,
  searchApiConfig: SearchApiConfig,
  options: WikiAssistSendOptions,
): Promise<WikiAssistContext> {
  const systemMessages: LLMMessage[] = []
  let queryRefs: MessageReference[] = []
  let langReminder: string | undefined
  lastQueryPages = []

  const greetingOnly = isGreeting(text)
  if (greetingOnly) {
    const outLang = getOutputLanguage(text)
    systemMessages.push({
      role: "system",
      content: [
        `You are a wiki assistant for the project "${project.projectName}".`,
        "The user sent a casual greeting — reply briefly and naturally, in one or two sentences.",
        "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
        "",
        `Respond in ${outLang}.`,
      ].join("\n"),
    })
    return { systemMessages, queryRefs, langReminder }
  }

  const pp = normalizePath(project.projectPath)
  const budget = computeContextBudget(llmConfig.maxContextSize)
  const libBudget = splitLibraryBudgets(budget, 1)

  const [rawIndex, purpose, searchResults] = await Promise.all([
    readFile(`${pp}/wiki/index.md`).catch(() => ""),
    readFile(`${pp}/purpose.md`).catch(() => ""),
    searchWiki(pp, text),
  ])

  const index = await trimWikiIndex(rawIndex, libBudget.indexBudget, text)
  const topSearchResults = searchResults.slice(0, 10)

  const { results: externalSearchResults, errors: externalSearchErrors } =
    await loadExternalSearchResults(
      text,
      searchApiConfig,
      llmConfig,
      pp,
      options,
    )

  let usedChars = 0
  const relevantPages: LoadedPage[] = []

  const tryAddPage = async (
    title: string,
    filePath: string,
  ): Promise<boolean> => {
    if (usedChars >= budget.pageBudget) return false
    try {
      const raw = await readFile(filePath)
      const relativePath = getRelativePath(filePath, pp)
      const truncated =
        raw.length > budget.maxPageSize
          ? raw.slice(0, budget.maxPageSize) + "\n\n[...truncated...]"
          : raw
      if (usedChars + truncated.length > budget.pageBudget) return false
      usedChars += truncated.length
      relevantPages.push({
        title,
        path: `${pp}/${relativePath.replace(/^\//, "")}`,
        content: truncated,
        projectName: project.projectName,
        projectPath: pp,
      })
      return true
    } catch {
      return false
    }
  }

  for (const r of topSearchResults.filter((r) => r.titleMatch)) {
    await tryAddPage(r.title, r.path)
  }
  for (const r of topSearchResults.filter((r) => !r.titleMatch)) {
    await tryAddPage(r.title, r.path)
  }
  if (relevantPages.length === 0) {
    await tryAddPage("Overview", `${pp}/wiki/overview.md`)
  }

  const externalContext = formatExternalSearchContext(externalSearchResults)
  const outLang = getOutputLanguage(text)

  systemMessages.push({
    role: "system",
    content: assembleSystemPrompt({
      projectLabel: project.projectName,
      multiLibrary: false,
      purposeSections: purpose ? [`## Wiki Purpose\n${purpose}`] : [],
      indexSections: index ? [`## Wiki Index\n${index}`] : [],
      relevantPages,
      externalContext,
      externalSearchErrors,
      outLang,
    }),
  })

  langReminder = buildLanguageReminder(text)
  lastQueryPages = relevantPages.map((p) => ({
    title: p.title,
    path: getRelativePath(p.path, p.projectPath),
  }))
  const externalRefs: MessageReference[] = externalSearchResults.map((result) => ({
    title: result.title,
    path: result.url,
    kind: "external",
    source: result.source,
    url: result.url,
    snippet: result.snippet,
  }))
  queryRefs = [
    ...relevantPages.map((p) => toWikiMessageReference(p)),
    ...externalRefs,
  ]

  return { systemMessages, queryRefs, langReminder }
}

async function buildMultiLibraryWikiAssistContext(
  projects: WikiAssistProject[],
  text: string,
  llmConfig: LlmConfig,
  searchApiConfig: SearchApiConfig,
  options: WikiAssistSendOptions,
): Promise<WikiAssistContext> {
  const systemMessages: LLMMessage[] = []
  let queryRefs: MessageReference[] = []
  let langReminder: string | undefined
  lastQueryPages = []

  const projectLabel = formatMultiProjectLabel(projects)

  const greetingOnly = isGreeting(text)
  if (greetingOnly) {
    const outLang = getOutputLanguage(text)
    systemMessages.push({
      role: "system",
      content: [
        `You are a wiki assistant for the projects "${projectLabel}".`,
        "The user sent a casual greeting — reply briefly and naturally, in one or two sentences.",
        "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
        "",
        `Respond in ${outLang}.`,
      ].join("\n"),
    })
    return { systemMessages, queryRefs, langReminder }
  }

  const budget = computeContextBudget(llmConfig.maxContextSize)
  const libBudget = splitLibraryBudgets(budget, projects.length)
  const primaryPath = normalizePath(projects[0]!.projectPath)

  const libraryData = await Promise.all(
    projects.map(async (project) => {
      const pp = normalizePath(project.projectPath)
      const [rawIndex, purpose, searchResults] = await Promise.all([
        readFile(`${pp}/wiki/index.md`).catch(() => ""),
        readFile(`${pp}/purpose.md`).catch(() => ""),
        searchWiki(pp, text, 10),
      ])
      const index = await trimWikiIndex(rawIndex, libBudget.indexBudget, text)
      const candidates = orderSearchCandidates(searchResults)
      if (candidates.length === 0) {
        candidates.push({
          title: "Overview",
          filePath: `${pp}/wiki/overview.md`,
          priority: 3,
        })
      }
      return { project, purpose, index, candidates }
    }),
  )

  const relevantPages = await collectInterleavedPages(
    libraryData.map((lib) => ({
      project: lib.project,
      perLibPageBudget: libBudget.pageBudget,
      candidates: lib.candidates,
    })),
    budget.pageBudget,
    libBudget.maxPageSize,
  )

  const { results: externalSearchResults, errors: externalSearchErrors } =
    await loadExternalSearchResults(
      text,
      searchApiConfig,
      llmConfig,
      primaryPath,
      options,
    )

  const externalContext = formatExternalSearchContext(externalSearchResults)
  const outLang = getOutputLanguage(text)

  const purposeSections = libraryData
    .filter((lib) => lib.purpose.trim())
    .map((lib) => `## Wiki Purpose (${lib.project.projectName})\n${lib.purpose}`)
  const indexSections = libraryData
    .filter((lib) => lib.index.trim())
    .map((lib) => `## Wiki Index (${lib.project.projectName})\n${lib.index}`)

  systemMessages.push({
    role: "system",
    content: assembleSystemPrompt({
      projectLabel,
      multiLibrary: true,
      purposeSections,
      indexSections,
      relevantPages,
      externalContext,
      externalSearchErrors,
      outLang,
    }),
  })

  langReminder = buildLanguageReminder(text)
  lastQueryPages = relevantPages.map((p) => ({
    title: p.title,
    path: p.path,
  }))
  const externalRefs: MessageReference[] = externalSearchResults.map((result) => ({
    title: result.title,
    path: result.url,
    kind: "external",
    source: result.source,
    url: result.url,
    snippet: result.snippet,
  }))
  queryRefs = [
    ...relevantPages.map((p) => toWikiMessageReference(p)),
    ...externalRefs,
  ]

  return { systemMessages, queryRefs, langReminder }
}
