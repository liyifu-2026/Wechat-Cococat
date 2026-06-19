import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  formatMaintainerBlockedChat,
  formatMaintainerMenu,
} from "./maintainer-menu.js";
import { assertAllLinesWithinMax } from "./wechat-line-wrap.test.js";

const prevData = process.env.COCOCAT_DATA_DIR;

beforeEach(() => {
  process.env.COCOCAT_DATA_DIR = mkdtempSync(join(tmpdir(), "cococat-menu-"));
});

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

describe("formatMaintainerMenu", () => {
  test("compact menu with short lines", () => {
    const text = formatMaintainerMenu({ wikiEnabled: true });
    assertAllLinesWithinMax(text);
    assert.match(text, /【维护菜单】/);
    assert.match(text, /菜单·本帮助/);
    assert.match(text, /列表·看客户/);
    assert.match(text, /scope·范围/);
    assert.doesNotMatch(text, /CocoCat · 维护者/);
  });

  test("shows idle hint when no mutes", () => {
    const text = formatMaintainerMenu({ wikiEnabled: false });
    assertAllLinesWithinMax(text);
    assert.match(text, /无待办可聊天/);
    assert.doesNotMatch(text, /scope/);
  });
});

describe("formatMaintainerBlockedChat", () => {
  test("mentions mute count and menu with short lines", () => {
    const text = formatMaintainerBlockedChat(2);
    assertAllLinesWithinMax(text);
    assert.match(text, /2/);
    assert.match(text, /菜单/);
  });
});
