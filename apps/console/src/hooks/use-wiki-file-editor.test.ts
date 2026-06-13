import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  shouldSkipWikiSave,
  WIKI_FILE_SAVE_DEBOUNCE_MS,
} from "@/hooks/use-wiki-file-editor"
import { wikiSaveRegistry } from "@/lib/wiki-file-save-registry"

const mockWriteFile = vi.fn(async (_path: string, _markdown: string) => undefined)

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => "基线数据"),
  writeFile: (path: string, markdown: string) => mockWriteFile(path, markdown),
}))

describe("useWikiFileEditor save contract (PR-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wikiSaveRegistry._clearForTests()
  })

  it("shouldSkipWikiSave ignores unchanged markdown", () => {
    expect(shouldSkipWikiSave("same", "same")).toBe(true)
    expect(shouldSkipWikiSave("changed", "same")).toBe(false)
  })

  it("registry flush invokes a registered writer with pending content", async () => {
    const path = "/path/refund.md"
    let pending = "用户修改后的全新 Markdown"
    const flush = vi.fn(async () => {
      await mockWriteFile(path, pending)
      wikiSaveRegistry.unregister(path)
    })
    wikiSaveRegistry.register(path, flush)

    await wikiSaveRegistry.flushAll()

    expect(flush).toHaveBeenCalledOnce()
    expect(mockWriteFile).toHaveBeenCalledWith(path, pending)
    expect(wikiSaveRegistry.getPendingCount()).toBe(0)
  })

  it("exports the same debounce interval as legacy editors", () => {
    expect(WIKI_FILE_SAVE_DEBOUNCE_MS).toBe(1000)
  })
})
