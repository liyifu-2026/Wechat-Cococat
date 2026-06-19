import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  maintainerIdentityFromList,
  parseMaintainersFromRaw,
} from "./maintainers.js";

describe("parseMaintainersFromRaw", () => {
  test("reads maintainers array", () => {
    const list = parseMaintainersFromRaw({
      maintainers: [
        { chatId: "wxid_a", displayName: "A" },
        { chatId: "wxid_b", displayName: "B" },
      ],
    });
    assert.equal(list.length, 2);
    assert.equal(list[0]?.chatId, "wxid_a");
  });

  test("migrates legacy maintainer object", () => {
    const list = parseMaintainersFromRaw({
      maintainer: { chatId: "wxid_legacy", displayName: "Legacy" },
    });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.chatId, "wxid_legacy");
  });

  test("dedupes by chatId", () => {
    const list = parseMaintainersFromRaw({
      maintainers: [
        { chatId: "wxid_a", displayName: "A" },
        { chatId: "wxid_a", displayName: "A2" },
      ],
    });
    assert.equal(list.length, 1);
  });
});

describe("maintainerIdentityFromList", () => {
  test("sorts chat ids", () => {
    assert.equal(
      maintainerIdentityFromList([
        { chatId: "wxid_b", displayName: "B" },
        { chatId: "wxid_a", displayName: "A" },
      ]),
      "wxid_a|wxid_b",
    );
  });

  test("tracks display-name-only maintainers", () => {
    assert.equal(
      maintainerIdentityFromList([
        { chatId: "", displayName: "Alice" },
        { chatId: "wxid_b", displayName: "B" },
      ]),
      "name:Alice|wxid_b",
    );
  });
});
