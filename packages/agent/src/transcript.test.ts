import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@cococat/shared";
import {
  transcriptLocalIdsOutOfOrder,
  transcriptNeedsRebuild,
  dbMessagesToTranscript,
} from "./transcript.js";
import type { TranscriptEntry } from "./transcript.js";

describe("transcript", () => {
  it("detects out-of-order localIds", () => {
    const entries: TranscriptEntry[] = [
      { role: "user", text: "a", localId: 1 },
      { role: "user", text: "c", localId: 3 },
      { role: "user", text: "b", localId: 2 },
    ];
    assert.equal(transcriptLocalIdsOutOfOrder(entries), true);
    const dbMessages = [{ localId: 4 }] as Message[];
    assert.equal(transcriptNeedsRebuild(5, dbMessages, entries), true);
  });

  it("accepts monotonic localIds", () => {
    const entries: TranscriptEntry[] = [
      { role: "user", text: "a", localId: 1 },
      { role: "user", text: "b", localId: 2 },
      { role: "user", text: "d", localId: 4 },
    ];
    assert.equal(transcriptLocalIdsOutOfOrder(entries), false);
  });

  it("formats emoji messages in dbMessagesToTranscript", () => {
    const messages = [
      {
        localId: 99,
        type: 47,
        isSelf: false,
        content: "<emoji>",
      },
    ] as Message[];
    const entries = dbMessagesToTranscript(messages, false, "/tmp/nope", 50);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.text, "（发了一个表情）");
    assert.equal(entries[0]!.localId, 99);
  });
});
