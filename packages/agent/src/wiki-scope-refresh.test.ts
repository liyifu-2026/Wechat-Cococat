import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  refreshAgentScopeForProject,
  runWikiScopeRefresh,
} from "./wiki-scope-refresh.js";

describe("wiki-scope-refresh", () => {
  let prevDataDir: string | undefined;
  let tempDir: string;
  let projectPath: string;

  beforeEach(() => {
    prevDataDir = process.env.COCOCAT_DATA_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "wiki-scope-refresh-"));
    process.env.COCOCAT_DATA_DIR = tempDir;
    projectPath = join(tempDir, "demo-wiki");
    mkdirSync(join(projectPath, "wiki"), { recursive: true });
    writeFileSync(
      join(projectPath, "wiki", "index.md"),
      "- [[refund]] — 退款说明\n",
      "utf8",
    );
    writeFileSync(
      join(projectPath, "wiki", "overview.md"),
      "# Overview\n\n测试 FAQ 库。\n",
      "utf8",
    );
  });

  afterEach(() => {
    if (prevDataDir === undefined) {
      delete process.env.COCOCAT_DATA_DIR;
    } else {
      process.env.COCOCAT_DATA_DIR = prevDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes project and shared agent-scope snapshots", () => {
    const payload = refreshAgentScopeForProject(projectPath);
    assert.ok(payload);
    assert.match(payload!.purpose, /测试 FAQ/);

    const projectScope = join(projectPath, ".llm-wiki", "agent-scope.json");
    const sharedDir = join(tempDir, "wiki-scope");
    assert.ok(existsSync(projectScope));

    const projectId = JSON.parse(
      readFileSync(join(projectPath, ".llm-wiki", "project.json"), "utf8"),
    ).id as string;
    const sharedScope = join(sharedDir, `${projectId}.json`);
    assert.ok(existsSync(sharedScope));
  });

  it("runWikiScopeRefresh skips non-wiki directories", () => {
    const emptyDir = join(tempDir, "not-wiki");
    mkdirSync(emptyDir);
    const report = runWikiScopeRefresh([projectPath, emptyDir]);
    assert.equal(report.refreshed.length, 1);
    assert.equal(report.skipped.length, 1);
  });
});
