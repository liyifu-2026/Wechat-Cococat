import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatMaintainerBlockedChat,
  formatMaintainerMenu,
} from "./maintainer-menu.js";
import { assertAllLinesWithinMax } from "./wechat-line-wrap.test.js";

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
