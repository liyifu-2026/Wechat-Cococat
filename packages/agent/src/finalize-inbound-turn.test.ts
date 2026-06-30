import test from "node:test";
import assert from "node:assert/strict";
import { shouldNotifyMaintainerForKnowledgeGap } from "./finalize-inbound-turn.js";

test("knowledge-gap reply on factual question notifies maintainer when wiki has no hit", () => {
  assert.equal(
    shouldNotifyMaintainerForKnowledgeGap({
      userLines: ["泳池防水涂层怎么做？"],
      sentTexts: ["我手头没现成教程，不过一般流程是先清理基面。"],
      wikiHits: [],
    }),
    true,
  );
});

test("knowledge-gap reply does not notify when wiki had a hit", () => {
  assert.equal(
    shouldNotifyMaintainerForKnowledgeGap({
      userLines: ["v9软件打不开怎么办？"],
      sentTexts: ["我帮您查一下。"],
      wikiHits: ["V9 常见问题"],
    }),
    false,
  );
});

test("ordinary answer does not notify maintainer", () => {
  assert.equal(
    shouldNotifyMaintainerForKnowledgeGap({
      userLines: ["v9软件打不开怎么办？"],
      sentTexts: ["先确认版本号，再重启电脑后重新打开。"],
      wikiHits: [],
    }),
    false,
  );
});
