import test from "node:test";
import assert from "node:assert/strict";
import { shouldRestoreFailure } from "./cache-utils.js";

test("does not restore expired or transient network failures from disk", () => {
  assert.equal(
    shouldRestoreFailure({ message: "fetch failed", expiresAt: 20_000 }, 10_000),
    false,
  );
  assert.equal(
    shouldRestoreFailure({ message: "upstream timeout", expiresAt: 20_000 }, 10_000),
    false,
  );
  assert.equal(
    shouldRestoreFailure({ message: "temporary upstream error", expiresAt: 10_000 }, 10_000),
    false,
  );
});

test("restores an active non-transient provider failure until its TTL expires", () => {
  assert.equal(
    shouldRestoreFailure({ message: "HTTP 429: rate limited", expiresAt: 20_000 }, 10_000),
    true,
  );
});
