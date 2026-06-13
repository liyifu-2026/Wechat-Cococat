import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { migrateLegacyModule } from "@/lib/console-layout"
import { useConsoleStore } from "@/stores/console-store"
import { useWikiStore } from "@/stores/wiki-store"

const consoleSrcRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const NO_LEGACY_WIKI_ESCAPE = [
  "App.tsx",
  "components/console/brain-wiki-panel.tsx",
  "components/console/system-knowledge-panel.tsx",
  "components/console/system-module.tsx",
  "components/console/command-palette.tsx",
]

function readConsoleSource(relativePath: string): string {
  return readFileSync(join(consoleSrcRoot, relativePath), "utf-8")
}

describe("Console v2 Phase 5 — activeView isolation & escape hatch removal", () => {
  beforeEach(() => {
    useWikiStore.setState({ activeView: "lint" })
    useConsoleStore.setState({ activeModule: "overview" })
  })

  it("J2: navigateSystemKnowledge resets global activeView to wiki", async () => {
    useConsoleStore.getState().navigateSystemKnowledge()

    expect(useWikiStore.getState().activeView).toBe("wiki")
    await vi.waitFor(() => {
      expect(useConsoleStore.getState().activeModule).toBe("system")
    })
    expect(useConsoleStore.getState().pendingSystemPanel).toBe("knowledge")
  })

  it("J4: core panels must not call setActiveModule('wiki')", () => {
    for (const relativePath of NO_LEGACY_WIKI_ESCAPE) {
      const source = readConsoleSource(relativePath)
      expect(source, relativePath).not.toMatch(
        /setActiveModule\s*\(\s*["']wiki["']\s*\)/,
      )
    }
  })

  it("J4: SystemKnowledgePanel must not mount legacy AppLayout", () => {
    const source = readConsoleSource("components/console/system-knowledge-panel.tsx")
    expect(source).not.toMatch(/<AppLayout\b/)
    expect(source).not.toMatch(/from\s+["']@\/components\/layout\/app-layout["']/)
  })

  it("J4: WikiExpertEmbed shell is removed from System module", () => {
    const source = readConsoleSource("components/console/system-module.tsx")
    expect(source).not.toMatch(/WikiExpertEmbed/)
    expect(source).toMatch(/SystemKnowledgePanel/)
  })
})

describe("Console v2 Phase 6A — single-track four-zone routing", () => {
  it("maps legacy wiki module to brain/kb", () => {
    const result = migrateLegacyModule("wiki")
    expect(result.module).toBe("brain")
    expect(result.brainTab).toBe("kb")
  })

  it("App.tsx renders only v2 four-zone modules (no legacy AppLayout tree)", () => {
    const source = readConsoleSource("App.tsx")
    expect(source).not.toMatch(/<AppLayout\b/)
    expect(source).not.toMatch(/<WelcomeScreen\b/)
    expect(source).not.toMatch(/activeModule === ["']wiki["']/)
    expect(source).toMatch(/OverviewModule/)
    expect(source).toMatch(/InboxModule/)
    expect(source).toMatch(/BrainModule/)
    expect(source).toMatch(/SystemModule/)
  })

  it("command palette routes Wiki entry to navigateBrain(kb)", () => {
    const source = readConsoleSource("components/console/command-palette.tsx")
    expect(source).not.toMatch(/setActiveModule\s*\(\s*["']wiki["']\s*\)/)
    expect(source).toMatch(/navigateBrain\s*\(\s*["']kb["']\s*\)/)
  })
})

describe("Console v2 Phase 6B — WikiWorkspace layout primitive", () => {
  it("Brain and System knowledge panels consume WikiWorkspace", () => {
    expect(readConsoleSource("components/console/brain-wiki-panel.tsx")).toMatch(
      /<WikiWorkspace\b/,
    )
    expect(readConsoleSource("components/console/system-knowledge-panel.tsx")).toMatch(
      /<WikiWorkspace\b/,
    )
  })

  it("legacy AppLayout and ContentArea are removed from the tree", () => {
    expect(() => readConsoleSource("components/layout/app-layout.tsx")).toThrow()
    expect(() => readConsoleSource("components/layout/content-area.tsx")).toThrow()
  })
})

describe("Console v2 Phase 6C — visibility gating", () => {
  it("stack health polling is delegated to StackHealthPoller", () => {
    expect(readConsoleSource("components/console/console-shell.tsx")).toMatch(
      /StackHealthPoller/,
    )
    expect(readConsoleSource("hooks/use-stack-health.ts")).not.toMatch(
      /setInterval\s*\(/,
    )
  })

  it("inbox and overview hooks use visibility gating", () => {
    expect(readConsoleSource("hooks/use-driver-inbox.ts")).toMatch(
      /useVisibilityGatedInterval/,
    )
    expect(readConsoleSource("hooks/use-console-events.ts")).toMatch(
      /useVisibilityGatedInterval/,
    )
    expect(readConsoleSource("components/console/inbox-mute-poller.tsx")).toMatch(
      /useVisibilityGatedInterval/,
    )
  })
})
