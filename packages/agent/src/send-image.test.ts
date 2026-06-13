import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSendImagePayload } from "./send-image.js";

describe("send-image", () => {
  it("loads image from local path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cococat-send-img-"));
    const file = join(dir, "test.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const payload = await resolveSendImagePayload({} as never, "chat", {
      path: file,
    });

    assert.equal(payload.mimeType, "image/png");
    assert.equal(payload.label, "（发了一张图）");
    assert.ok(payload.data.length > 0);
  });

  it("rejects missing sources", async () => {
    await assert.rejects(
      () => resolveSendImagePayload({} as never, "chat", {}),
      /需要 localId/,
    );
  });
});
