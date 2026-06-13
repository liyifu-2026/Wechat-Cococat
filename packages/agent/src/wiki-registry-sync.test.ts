import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegistryFromConsoleProjects,
  pickDefaultWikiAliases,
} from "./wiki-registry-sync.js";

describe("wiki-registry-sync", () => {
  it("maps project name, id, and folder to uuid", () => {
    const reg = buildRegistryFromConsoleProjects([
      {
        id: "uuid-1",
        name: "FAQ",
        path: "/home/me/wiki/FAQ",
      },
    ]);
    assert.equal(reg.get("FAQ"), "uuid-1");
    assert.equal(reg.get("uuid-1"), "uuid-1");
    assert.equal(reg.get("FAQ"), "uuid-1");
  });

  it("auto-picks sole project", () => {
    const aliases = pickDefaultWikiAliases([
      { id: "a", name: "售后库", path: "/x/售后库" },
    ]);
    assert.deepEqual(aliases, ["售后库"]);
  });

  it("auto-picks all named projects when multiple", () => {
    const aliases = pickDefaultWikiAliases([
      { id: "a", name: "FAQ", path: "/x/faq" },
      { id: "b", name: "工作", path: "/x/work" },
    ]);
    assert.deepEqual(aliases, ["FAQ", "工作"]);
  });
});
