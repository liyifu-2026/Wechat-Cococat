import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isQuietHoursNow } from "./quiet-hours.js";

describe("quiet-hours", () => {
  it("returns false when quiet hours not configured", () => {
    assert.equal(isQuietHoursNow(undefined), false);
  });
});
