import { describe, expect, it } from "vitest"
import {
  parseChatWikiProjects,
  resolveWikiAliasesSync,
  type WikiAliasRegistry,
} from "@/lib/resolve-inbox-chat-wiki"
import type { ProjectRegistry } from "@/lib/project-identity"

const projectRegistry: ProjectRegistry = {
  "id-faq": {
    id: "id-faq",
    path: "/data/faq-wiki",
    name: "FAQ",
    lastOpened: 1,
  },
  "id-ops": {
    id: "id-ops",
    path: "/data/ops-wiki",
    name: "运维库",
    lastOpened: 2,
  },
}

const wikiRegistry: WikiAliasRegistry = {
  FAQ: "id-faq",
  运维库: "id-ops",
}

describe("parseChatWikiProjects", () => {
  it("parses projects array", () => {
    expect(
      parseChatWikiProjects(JSON.stringify({ projects: ["FAQ", "运维库"] })),
    ).toEqual(["FAQ", "运维库"])
  })

  it("returns empty for missing file content", () => {
    expect(parseChatWikiProjects("")).toEqual([])
    expect(parseChatWikiProjects("{}")).toEqual([])
  })
})

describe("resolveWikiAliasesSync", () => {
  it("returns unbound for empty aliases", () => {
    const r = resolveWikiAliasesSync([], wikiRegistry, projectRegistry)
    expect(r.status).toBe("unbound")
  })

  it("resolves multiple aliases via registry", () => {
    const r = resolveWikiAliasesSync(["FAQ", "运维库"], wikiRegistry, projectRegistry)
    expect(r.status).toBe("ok")
    expect(r.resolved).toHaveLength(2)
    expect(r.resolved[0]?.projectPath).toBe("/data/faq-wiki")
  })

  it("returns partial when some aliases invalid", () => {
    const r = resolveWikiAliasesSync(
      ["FAQ", "missing"],
      wikiRegistry,
      projectRegistry,
    )
    expect(r.status).toBe("partial")
    expect(r.resolved).toHaveLength(1)
    expect(r.invalidAliases).toEqual(["missing"])
  })

  it("returns broken when all aliases invalid", () => {
    const r = resolveWikiAliasesSync(
      ["nope", "also-nope"],
      wikiRegistry,
      projectRegistry,
    )
    expect(r.status).toBe("broken")
    expect(r.resolved).toHaveLength(0)
  })

  it("dedupes same project path bound under two aliases", () => {
    const dupRegistry: WikiAliasRegistry = {
      FAQ: "id-faq",
      faq2: "id-faq",
    }
    const r = resolveWikiAliasesSync(
      ["FAQ", "faq2"],
      dupRegistry,
      projectRegistry,
    )
    expect(r.resolved).toHaveLength(1)
    expect(r.invalidAliases).toContain("faq2")
  })
})
