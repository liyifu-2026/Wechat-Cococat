import { useState, useCallback, useMemo, useEffect } from "react"
import { Search, FileText, ImageIcon } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { searchWiki, tokenizeQuery, type SearchResult, type ImageRef } from "@/lib/search"
import {
  searchWikiFederated,
  type FederatedWikiProject,
} from "@/lib/search-wiki-federated"
import { useTranslation } from "react-i18next"
import { normalizePath } from "@/lib/path-utils"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { findRawSourceForImage, imageUrlToAbsolute } from "@/lib/raw-source-resolver"
import { isImeComposing } from "@/lib/keyboard-utils"
import { useLightboxStore } from "@/stores/lightbox-store"

import type { WikiReferenceOpenMeta } from "@/lib/wiki-reference-path"

export type WikiSearchOpenMeta = WikiReferenceOpenMeta

export type WikiSearchWorkspaceProps = {
  variant?: "brain" | "inbox"
  autoFocus?: boolean
  className?: string
  /** Opens a result inline (AI assist expand) instead of Brain wiki store. */
  onOpenPage?: (path: string, title?: string, meta?: WikiSearchOpenMeta) => void
  /** Inbox AI assist: no top search bar; search driven by parent composer. */
  embedded?: boolean
  /** Query submitted from InboxAiComposer (embedded mode). */
  submittedQuery?: string
  /** Per-chat federated libraries (inbox embedded). When set, ignores global wiki project. */
  federatedProjects?: FederatedWikiProject[]
}

/**
 * One image hit displayed in the Images section.
 *
 * `sourcePath` is the wiki page that contains this image reference
 * — clicking the card opens that page (and the page's markdown
 * preview will scroll the user down to the image naturally).
 *
 * `altMatchesQuery` is whether the caption / alt text matches the
 * query. Used only for ordering: caption matches sort first.
 */
interface ImageHit extends ImageRef {
  sourcePath: string
  sourceTitle: string
  sourceProjectPath: string | null
  altMatchesQuery: boolean
}

type WorkspaceSearchResult = SearchResult & {
  projectPath?: string
  projectName?: string
  relPath?: string
}

export function WikiSearchWorkspace({
  variant = "brain",
  autoFocus = true,
  className = "",
  onOpenPage,
  embedded = false,
  submittedQuery = "",
  federatedProjects,
}: WikiSearchWorkspaceProps) {
  const inbox = variant === "inbox"
  const inputClass = inbox
    ? "w-full rounded-md border border-[var(--wx-border)] bg-[var(--wx-search-input)] py-2 pl-9 pr-3 text-sm text-[var(--wx-text)] placeholder:text-[var(--wx-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--wx-accent)]"
    : "w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  const mutedClass = inbox ? "text-[var(--wx-muted)]" : "text-muted-foreground"
  const cardClass = inbox
    ? "w-full rounded-lg border border-[var(--wx-border)] bg-[var(--wx-search-input)] p-3 text-left text-sm transition hover:bg-[var(--wx-list-hover)]"
    : "w-full rounded-lg border p-3 text-left text-sm hover:bg-accent transition-colors"
  const imageCardClass = inbox
    ? "group flex h-44 flex-col overflow-hidden rounded-lg border border-[var(--wx-border)] bg-[var(--wx-search-input)] text-left transition-colors hover:bg-[var(--wx-list-hover)]"
    : "group flex h-44 flex-col overflow-hidden rounded-lg border bg-background text-left transition-colors hover:bg-accent"

  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<WorkspaceSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const openLightbox = useLightboxStore((s) => s.open)

  const isFederated = federatedProjects != null
  const activeQuery = embedded ? submittedQuery : query

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        setResults([])
        return
      }

      if (isFederated) {
        if (federatedProjects!.length === 0) {
          setResults([])
          return
        }
        setSearching(true)
        setHasSearched(true)
        try {
          const found = await searchWikiFederated(federatedProjects!, trimmed)
          setResults(found)
        } catch (err) {
          console.error("Federated search failed:", err)
          setResults([])
        } finally {
          setSearching(false)
        }
        return
      }

      if (!project) {
        setResults([])
        return
      }
      setSearching(true)
      setHasSearched(true)
      try {
        const found = await searchWiki(normalizePath(project.path), trimmed)
        setResults(found)
      } catch (err) {
        console.error("Search failed:", err)
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [federatedProjects, isFederated, project],
  )

  useEffect(() => {
    if (!embedded) return
    if (!submittedQuery.trim()) {
      setResults([])
      setHasSearched(false)
      return
    }
    void doSearch(submittedQuery)
  }, [embedded, submittedQuery, doSearch])

  // Flatten + dedupe images across results. Two results referencing
  // the same image (e.g. the source-summary AND a concept page that
  // cited the figure) collapse to one card; we keep the FIRST
  // result we saw it in as the click target since results are
  // already sorted by RRF descending.
  //
  // Caption matching uses the SAME tokenizer the main search uses
  // (`tokenizeQuery`), not raw substring containment. Without this
  // a query like "总资产。" wouldn't match the caption "图：2023
  // 年总资产合计" — the trailing 。 has no business in a substring
  // test against alt text that doesn't end at that exact spot.
  // Falls back to the raw lowercased query when tokenization
  // returns nothing (e.g. user typed only punctuation), so the
  // filter never silently goes empty when the user expected hits.
  const imageHits = useMemo(() => {
    if (!activeQuery.trim()) return [] as ImageHit[]
    const tokens = tokenizeQuery(activeQuery)
    const fallback = activeQuery.trim().toLowerCase()
    const seen = new Set<string>()
    const out: ImageHit[] = []
    for (const r of results) {
      for (const img of r.images) {
        if (seen.has(img.url)) continue
        seen.add(img.url)
        const altLower = img.alt.toLowerCase()
        const altMatchesQuery =
          tokens.length > 0
            ? tokens.some((t) => altLower.includes(t))
            : altLower.includes(fallback)
        out.push({
          ...img,
          sourcePath: r.path,
          sourceTitle: r.title,
          sourceProjectPath: r.projectPath ?? project?.path ?? null,
          altMatchesQuery,
        })
      }
    }
    // Caption-matches first, then preserve RRF order.
    return out.sort((a, b) => Number(b.altMatchesQuery) - Number(a.altMatchesQuery))
  }, [results, activeQuery, project?.path])

  // Image hits whose CAPTION matches the query are the ones we
  // confidently surface. Hits from matched pages whose alt text
  // doesn't match the query are "supporting" (visible after a
  // toggle) — showing them ALL by default would dilute the image
  // grid with logos / page-corner decorations.
  const [showSupportingImages, setShowSupportingImages] = useState(false)
  const matchingImages = imageHits.filter((h) => h.altMatchesQuery)
  const supportingImages = imageHits.filter((h) => !h.altMatchesQuery)
  const visibleImages = showSupportingImages ? imageHits : matchingImages

  async function handleOpen(
    path: string,
    title?: string,
    meta?: WikiSearchOpenMeta,
  ) {
    if (onOpenPage) {
      onOpenPage(path, title, meta)
      return
    }
    try {
      const content = await readFile(path)
      setSelectedFile(path)
      setFileContent(content)
    } catch (err) {
      console.error("Failed to open search result:", err)
    }
  }

  /**
   * Lightbox jump-to-source: open the ORIGINAL raw source file
   * (the PDF / DOCX / PPTX in `raw/sources/`), not the LLM-
   * summarized `wiki/sources/<slug>.md`. The wiki summary is
   * abbreviated by design — the user's mental model when they
   * click a search-result image is "show me where this came
   * from in the actual document," and that's the raw file.
   *
   * Path derivation: image URLs always live under
   * `<project>/wiki/media/<slug>/img-N.<ext>`. The slug matches
   * the basename of the original raw source (we wrote it that
   * way at extraction time in extract_pdf_markdown / fs.rs's
   * raw-sources-layout heuristic). We list `raw/sources/` once
   * and pick the file whose stem equals the slug.
   *
   * The raw file's preview goes through `read_file` → the
   * combined-extraction path (text + per-page image refs with
   * absolute URLs), which means the `<img data-mdsrc=...>` we
   * scroll-target lives in the same DOM. To match what the
   * preview emits, we normalize `hit.url` to its absolute form
   * before staging the pending scroll — wiki-relative URLs
   * (from the safety-net section) wouldn't otherwise match the
   * absolute URLs the raw extractor uses.
   *
   * Fallback: if we can't find a raw source file (e.g. the user
   * deleted it after ingest, leaving only the wiki summary), we
   * open the wiki page so SOMETHING happens.
   */
  async function handleJumpFromLightbox(hit: ImageHit) {
    const projectPath = hit.sourceProjectPath ?? project?.path
    let openPath = hit.sourcePath
    let scrollTarget = hit.url

    if (projectPath) {
      const pp = normalizePath(projectPath)
      const rawPath = await findRawSourceForImage(hit.url, pp)
      if (rawPath) {
        console.log(`[search:jump] ${hit.url} → raw source ${rawPath}`)
        openPath = rawPath
        scrollTarget = imageUrlToAbsolute(scrollTarget, pp)
      } else {
        console.warn(
          `[search:jump] no raw source found for image ${hit.url} — falling back to wiki page`,
        )
      }
    }

    try {
      if (onOpenPage) {
        useLightboxStore.getState().close()
        onOpenPage(openPath, hit.sourceTitle)
        return
      }
      const content = await readFile(openPath)
      setPendingScrollImageSrc(scrollTarget)
      setSelectedFile(openPath)
      setFileContent(content)
      useLightboxStore.getState().close()
    } catch (err) {
      console.error("Failed to jump to source:", err)
    }
  }

  function openSearchLightbox(hit: ImageHit, gallery: ImageHit[]) {
    const projectPath = project?.path ?? null
    const items = gallery.map((img) => ({
      id: img.url,
      src: resolveMarkdownImageSrc(img.url, projectPath),
      alt: img.alt,
      subtitle: img.sourceTitle,
      onJumpToSource: () => handleJumpFromLightbox(img),
    }))
    const index = gallery.findIndex((img) => img.url === hit.url)
    openLightbox({ items, index: Math.max(0, index) })
  }

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
      {!embedded && (
      <div className={`shrink-0 border-b px-4 py-3 ${inbox ? "border-[var(--wx-border)]" : ""}`}>
        <div className="relative">
          <Search className={`absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${mutedClass}`} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return
              if (e.key === "Enter") doSearch(query)
            }}
            placeholder={
              inbox
                ? t("wechat.aiAssist.searchPlaceholder")
                : `${t("search.placeholder")} (Enter to search)`
            }
            autoFocus={autoFocus}
            className={inputClass}
          />
        </div>
      </div>
      )}

      {/*
       * Body. Two independently scrollable regions: images (capped
       * height = 2 rows of thumbnails) and pages (fills the rest).
       * Stacked, no outer scroll — the user asked for "image grid
       * doesn't push the text list off-screen, both areas scroll
       * inside themselves."
       */}
      {searching ? (
        <div className={`flex-1 p-4 text-center text-sm ${mutedClass}`}>
          {inbox ? t("wechat.aiAssist.searching") : "Searching..."}
        </div>
      ) : !hasSearched ? (
        <div className={`flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm ${mutedClass}`}>
          <Search className={`h-8 w-8 ${inbox ? "text-[var(--wx-muted)]/30" : "text-muted-foreground/30"}`} />
          <p>{inbox ? t("wechat.aiAssist.searchHint") : "Press Enter to search"}</p>
        </div>
      ) : results.length === 0 ? (
        <div className={`flex-1 p-4 text-center text-sm ${mutedClass}`}>
          {inbox ? t("wechat.aiAssist.noResults") : t("search.noResults")}{" "}
          <span className="font-medium">"{activeQuery}"</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`shrink-0 px-3 pt-3 pb-1 text-xs ${mutedClass}`}>
            {results.length} page{results.length !== 1 ? "s" : ""}
            {imageHits.length > 0 && (
              <>
                {" · "}
                {matchingImages.length} image{matchingImages.length !== 1 ? "s" : ""} match
                {supportingImages.length > 0 && ` · +${supportingImages.length} from matched pages`}
              </>
            )}
          </div>

          {/* ── Images: fixed-height thumbnails, 2 rows visible, scrolls inside ── */}
          {visibleImages.length > 0 && (
            <>
              <div className="shrink-0 px-3 pt-1">
                <SectionHeader
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Images"
                  count={visibleImages.length}
                  mutedClass={mutedClass}
                  trailing={
                    supportingImages.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowSupportingImages((s) => !s)}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        {showSupportingImages
                          ? "Hide supporting"
                          : `Show all (+${supportingImages.length})`}
                      </button>
                    ) : null
                  }
                />
              </div>
              {/*
               * Cap height at 2-rows-worth of cards. Each `ImageHitCard`
               * is fixed at ~176px tall (120px thumbnail + 2-line
               * caption + source title + padding); with `gap-2` (8px)
               * between rows that's ~360px for two rows. We pad to
               * 23rem (368px) so the bottom edge of the second row
               * isn't visually flush with the scrollbar / next
               * section. Anything beyond 2 rows stays accessible via
               * vertical scroll inside this container ONLY — the
               * Pages list below keeps its own scroll independent.
               */}
              <div className="max-h-[23rem] shrink-0 overflow-y-auto px-3 pt-2 pb-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleImages.map((img) => (
                    <ImageHitCard
                      key={img.url}
                      hit={img}
                      query={activeQuery}
                      cardClass={imageCardClass}
                      mutedClass={mutedClass}
                      onClick={() => openSearchLightbox(img, visibleImages)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Pages: takes remaining vertical space, scrolls inside ── */}
          <div className="shrink-0 px-3 pt-1">
            <SectionHeader
              icon={<FileText className="h-3.5 w-3.5" />}
              label="Pages"
              count={results.length}
              mutedClass={mutedClass}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
            <div className="flex flex-col gap-1">
              {results.map((result) => (
                <SearchResultCard
                  key={`${result.projectPath ?? ""}:${result.path}`}
                  result={result}
                  query={activeQuery}
                  cardClass={cardClass}
                  mutedClass={mutedClass}
                  onClick={() =>
                    handleOpen(result.path, result.title, {
                      projectPath: result.projectPath,
                      relPath: result.relPath,
                      projectName: result.projectName,
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({
  icon,
  label,
  count,
  mutedClass = "text-muted-foreground",
  trailing,
}: {
  icon: React.ReactNode
  label: string
  count: number
  mutedClass?: string
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b pb-1">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${mutedClass}`}>
        {icon}
        {label}
        <span className="opacity-60">({count})</span>
      </div>
      {trailing}
    </div>
  )
}

function ImageHitCard({
  hit,
  query,
  cardClass,
  mutedClass = "text-muted-foreground",
  onClick,
}: {
  hit: ImageHit
  query: string
  cardClass: string
  mutedClass?: string
  onClick: () => void
}) {
  const globalProject = useWikiStore((s) => s.project)
  const projectPath = hit.sourceProjectPath ?? globalProject?.path ?? null
  // Same resolver the markdown preview uses — handles absolute
  // filesystem paths (which our extractor emits) AND wiki-relative
  // paths (which the safety-net section emits).
  const src = resolveMarkdownImageSrc(hit.url, projectPath)

  return (
    <button
      type="button"
      onClick={onClick}
      title={hit.alt || hit.sourceTitle}
      className={cardClass}
    >
      {/*
       * Fixed thumbnail height (h-30 = 120px). Width fills the grid
       * cell. `object-cover` keeps the source's aspect ratio while
       * cropping to fill — preferable to letterboxing for a thumb
       * grid where users skim by visual identity rather than read
       * the chart axes. Combined with the parent's fixed h-44 (176px)
       * and the text block's `flex-1` cap, every card has the SAME
       * total height regardless of caption length, which keeps the
       * grid's row alignment clean.
       */}
      <div className="h-30 w-full shrink-0 overflow-hidden bg-muted" style={{ height: "7.5rem" }}>
        {/* `loading="lazy"` matters: a project with hundreds of
         *  images would otherwise issue a request for every one
         *  on first render, even when most are scrolled offscreen. */}
        <img
          src={src}
          alt={hit.alt || ""}
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          // Hide broken-image icon when convertFileSrc can't resolve
          // (network image deleted, project moved, etc.) — leave the
          // bg-muted placeholder visible instead of a sad 🖼️.
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.opacity = "0"
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
        {hit.alt ? (
          <div className="line-clamp-2 text-[11px] leading-snug">
            <HighlightedText text={hit.alt} query={query} />
          </div>
        ) : (
          <div className={`text-[11px] italic ${mutedClass}`}>No caption</div>
        )}
        <div className={`mt-auto truncate text-[10px] ${mutedClass}`}>
          {hit.sourceTitle}
        </div>
      </div>
    </button>
  )
}

function SearchResultCard({
  result,
  query,
  cardClass,
  mutedClass = "text-muted-foreground",
  onClick,
}: {
  result: WorkspaceSearchResult
  query: string
  cardClass: string
  mutedClass?: string
  onClick: () => void
}) {
  const shortPath =
    result.relPath ??
    result.path.split("/wiki/").pop() ??
    result.path
  const projectLabel = result.projectName

  return (
    <button type="button" onClick={onClick} className={cardClass}>
      <div className="mb-1.5 flex items-start gap-2">
        <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${mutedClass}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            <HighlightedText text={result.title} query={query} />
          </div>
          <div className={`truncate text-[11px] ${mutedClass}`}>
            {projectLabel ? `${projectLabel} · ${shortPath}` : shortPath}
          </div>
        </div>
      </div>
      <p className={`line-clamp-2 text-xs ${mutedClass}`}>
        <HighlightedText text={result.snippet} query={query} />
      </p>
    </button>
  )
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>

  // Highlight EACH non-stopword token from the query, not the raw
  // query string. Same rationale as the alt-text filter above:
  // "总资产。" should still highlight "总资产" inside captions /
  // titles even though the period prevents a literal substring
  // match. Falls back to the raw query when the tokenizer returned
  // nothing, so a query like "(?)" still attempts highlighting
  // (and trivially finds nothing, which is fine).
  const tokens = tokenizeQuery(query)
  const patterns = tokens.length > 0 ? tokens : [query.trim()]
  const regex = new RegExp(`(${patterns.map(escapeRegex).join("|")})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
