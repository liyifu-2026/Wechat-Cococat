import { describe, expect, it } from "vitest"
import {
  resolveWikiAbsolutePath,
  wikiCitationReadCandidates,
  wikiReferenceAbsolutePath,
  wikiReferenceToOpenMeta,
} from "@/lib/wiki-reference-path"

describe("resolveWikiAbsolutePath", () => {
  it("joins projectPath + relPath", () => {
    expect(
      resolveWikiAbsolutePath({
        path: "ignored",
        projectPath: "/data/wiki-a",
        relPath: "wiki/faq/refund.md",
      }),
    ).toBe("/data/wiki-a/wiki/faq/refund.md")
  })

  it("returns absolute path unchanged", () => {
    expect(
      resolveWikiAbsolutePath({
        path: "/data/wiki-a/wiki/faq/refund.md",
      }),
    ).toBe("/data/wiki-a/wiki/faq/refund.md")
  })

  it("joins relative path with projectPath when relPath absent", () => {
    expect(
      resolveWikiAbsolutePath({
        path: "wiki/faq/refund.md",
        projectPath: "/data/wiki-a",
      }),
    ).toBe("/data/wiki-a/wiki/faq/refund.md")
  })
})

describe("wikiReferenceToOpenMeta", () => {
  it("derives relPath from absolute path + projectPath", () => {
    expect(
      wikiReferenceToOpenMeta({
        path: "/data/wiki-a/wiki/faq/refund.md",
        projectPath: "/data/wiki-a",
        projectName: "FAQ",
      }),
    ).toEqual({
      projectPath: "/data/wiki-a",
      relPath: "wiki/faq/refund.md",
      projectName: "FAQ",
    })
  })
})

describe("wikiReferenceAbsolutePath", () => {
  it("prefers relPath over ambiguous path field", () => {
    expect(
      wikiReferenceAbsolutePath({
        path: "wiki/other.md",
        projectPath: "/libs/faq",
        relPath: "wiki/faq/refund.md",
      }),
    ).toBe("/libs/faq/wiki/faq/refund.md")
  })
})

describe("wikiCitationReadCandidates", () => {
  it("returns a single absolute path when projectPath metadata is present", () => {
    expect(
      wikiCitationReadCandidates(
        {
          path: "/data/faq/wiki/refund.md",
          projectPath: "/data/faq",
          relPath: "wiki/refund.md",
        },
        "/ignored/global",
      ),
    ).toEqual(["/data/faq/wiki/refund.md"])
  })
})
