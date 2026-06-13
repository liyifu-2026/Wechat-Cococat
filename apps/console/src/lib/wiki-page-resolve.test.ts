import { describe, expect, it } from "vitest"
import type { FileNode } from "@/types/wiki"
import {
  resolveWikiDeepLink,
  resolveWikiPathByExplicitPath,
  resolveWikiPathByTopic,
} from "./wiki-page-resolve"

const mockFileTree: FileNode[] = [
  {
    name: "wiki",
    path: "/proj/wiki",
    is_dir: true,
    children: [
      {
        name: "faq",
        path: "/proj/wiki/faq",
        is_dir: true,
        children: [
          {
            name: "refund.md",
            path: "/proj/wiki/faq/refund.md",
            is_dir: false,
          },
          {
            name: "01_pricing_tier.md",
            path: "/proj/wiki/faq/01_pricing_tier.md",
            is_dir: false,
          },
        ],
      },
      {
        name: "persona.md",
        path: "/proj/wiki/persona.md",
        is_dir: false,
      },
    ],
  },
]

describe("resolveWikiPathByTopic (PR-3)", () => {
  it("matches exact file stem", () => {
    expect(resolveWikiPathByTopic(mockFileTree, "refund")).toBe(
      "/proj/wiki/faq/refund.md",
    )
  })

  it("matches partial filename", () => {
    expect(resolveWikiPathByTopic(mockFileTree, "pricing")).toBe(
      "/proj/wiki/faq/01_pricing_tier.md",
    )
  })

  it("returns null when nothing matches", () => {
    expect(resolveWikiPathByTopic(mockFileTree, "年终奖大包折扣")).toBeNull()
  })
})

describe("resolveWikiPathByExplicitPath", () => {
  it("matches indexed absolute path", () => {
    expect(
      resolveWikiPathByExplicitPath(mockFileTree, "/proj/wiki/faq/refund.md"),
    ).toBe("/proj/wiki/faq/refund.md")
  })

  it("matches suffix path fragment", () => {
    expect(resolveWikiPathByExplicitPath(mockFileTree, "wiki/faq/refund.md")).toBe(
      "/proj/wiki/faq/refund.md",
    )
  })
})

describe("resolveWikiDeepLink", () => {
  it("prefers wikiPath over topic", () => {
    expect(
      resolveWikiDeepLink(mockFileTree, {
        wikiPath: "/proj/wiki/persona.md",
        topic: "refund",
      }),
    ).toBe("/proj/wiki/persona.md")
  })

  it("falls back to topic when wikiPath missing", () => {
    expect(resolveWikiDeepLink(mockFileTree, { topic: "refund" })).toBe(
      "/proj/wiki/faq/refund.md",
    )
  })
})
