import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WikiProject } from "@/types/wiki"
import { useChatStore } from "@/stores/chat-store"
import { useLintStore } from "@/stores/lint-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"

const mockResetProjectState = vi.fn(async () => {})
const mockIngestRestoreQueue = vi.fn(async (_id: string, _path: string) => {})
const mockDedupRestoreQueue = vi.fn(async (_id: string, _path: string) => {})
const mockListDirectory = vi.fn(async (_path: string) => [] as unknown[])
const mockSaveLastProject = vi.fn(async (_proj: WikiProject) => {})
const mockLoadOutputLanguage = vi.fn(async (_id: string) => "auto" as const)
const mockLoadScheduledImportConfig = vi.fn(async (_path: string) => null)
const mockLoadSourceWatchConfig = vi.fn(async (_id: string) => ({ enabled: false }))
const mockLoadReviewItems = vi.fn(async (_path: string) => [] as unknown[])
const mockLoadLintItems = vi.fn(async (_path: string) => [] as unknown[])
const mockLoadChatHistory = vi.fn(async (_path: string) => ({
  conversations: [] as unknown[],
  messages: [] as unknown[],
}))

vi.mock("@/lib/reset-project-state", () => ({
  resetProjectState: () => mockResetProjectState(),
}))

vi.mock("@/lib/ingest-queue", () => ({
  restoreQueue: (id: string, path: string) => mockIngestRestoreQueue(id, path),
}))

vi.mock("@/lib/dedup-queue", () => ({
  restoreQueue: (id: string, path: string) => mockDedupRestoreQueue(id, path),
}))

vi.mock("@/lib/scheduled-import", () => ({
  startScheduledImport: vi.fn(),
}))

vi.mock("@/lib/project-file-sync", () => ({
  startProjectFileSync: vi.fn(async () => {}),
  stopProjectFileSync: vi.fn(async () => {}),
}))

vi.mock("@/commands/fs", () => ({
  listDirectory: (path: string) => mockListDirectory(path),
}))

vi.mock("@/lib/project-store", () => ({
  saveLastProject: (proj: WikiProject) => mockSaveLastProject(proj),
  loadOutputLanguage: (id: string) => mockLoadOutputLanguage(id),
  loadScheduledImportConfig: (path: string) => mockLoadScheduledImportConfig(path),
  loadSourceWatchConfig: (id: string) => mockLoadSourceWatchConfig(id),
}))

vi.mock("@/lib/persist", () => ({
  loadReviewItems: (path: string) => mockLoadReviewItems(path),
  loadLintItems: (path: string) => mockLoadLintItems(path),
  loadChatHistory: (path: string) => mockLoadChatHistory(path),
}))

import { openWikiProject } from "./open-wiki-project"

const mockProject: WikiProject = {
  id: "proj_test_q4",
  name: "测试知识库",
  path: "/user/wiki/cococat",
}

describe("openWikiProject (PR-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      project: null,
      fileTree: [],
      selectedFile: "/stale/other-project/page.md",
      activeView: "lint",
      dataVersion: 0,
    })
    useReviewStore.setState({ items: [] })
    useLintStore.setState({ items: [] })
    useChatStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
    })
    mockListDirectory.mockResolvedValue([
      { name: "wiki", path: "/user/wiki/cococat/wiki", is_dir: true },
    ])
  })

  it("awaits resetProjectState before mounting the new project", async () => {
    const callOrder: string[] = []
    mockResetProjectState.mockImplementation(async () => {
      callOrder.push("reset")
    })
    const originalSetProject = useWikiStore.getState().setProject
    useWikiStore.setState({
      setProject: (proj) => {
        callOrder.push("setProject")
        originalSetProject(proj)
      },
    })

    await openWikiProject(mockProject, { source: "brain" })

    expect(callOrder.indexOf("reset")).toBeLessThan(callOrder.indexOf("setProject"))
    expect(mockResetProjectState).toHaveBeenCalledOnce()
  })

  it("clears selectedFile and restores ingest queue for the project", async () => {
    await openWikiProject(mockProject, { source: "welcome" })

    expect(useWikiStore.getState().selectedFile).toBeNull()
    expect(useWikiStore.getState().project).toEqual(mockProject)
    expect(useWikiStore.getState().activeView).toBe("wiki")
    expect(mockIngestRestoreQueue).toHaveBeenCalledWith(
      mockProject.id,
      mockProject.path,
    )
    expect(mockSaveLastProject).toHaveBeenCalledWith(mockProject)
    expect(mockListDirectory).toHaveBeenCalledWith(mockProject.path)
    expect(useWikiStore.getState().fileTree).toHaveLength(1)
  })

  it("reports fileTreeLoaded=false when listDirectory fails without unmounting project", async () => {
    mockListDirectory.mockRejectedValueOnce(new Error("Disk IO Error"))

    const result = await openWikiProject(mockProject, { source: "brain" })

    expect(result.fileTreeLoaded).toBe(false)
    expect(useWikiStore.getState().project).toEqual(mockProject)
    expect(useWikiStore.getState().fileTree).toEqual([])
  })

  it("loads persisted review/lint/chat data after project mount", async () => {
    mockLoadReviewItems.mockResolvedValueOnce([
      {
        id: "r1",
        type: "missing-page",
        title: "x",
        description: "",
        options: [],
        resolved: false,
        createdAt: 1,
      },
    ])
    mockLoadLintItems.mockResolvedValueOnce([
      {
        id: "l1",
        type: "broken-link",
        severity: "warning",
        page: "wiki/a.md",
        detail: "missing target",
        createdAt: 1,
      },
    ])
    mockLoadChatHistory.mockResolvedValueOnce({
      conversations: [
        { id: "c1", title: "t", createdAt: 1, updatedAt: 2 },
      ],
      messages: [
        {
          id: "m1",
          role: "user" as const,
          content: "hi",
          timestamp: 0,
          conversationId: "c1",
        },
      ],
    })

    await openWikiProject(mockProject)

    expect(useReviewStore.getState().items).toHaveLength(1)
    expect(useLintStore.getState().items).toHaveLength(1)
    expect(useChatStore.getState().conversations).toHaveLength(1)
    expect(useChatStore.getState().activeConversationId).toBe("c1")
  })
})
