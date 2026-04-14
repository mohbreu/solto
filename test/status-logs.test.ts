import test from "node:test";
import assert from "node:assert/strict";

import {
  compactStartupNoise,
  parseTailLimit,
  selectLatestErrorEntries,
} from "../src/status-logs.ts";

test("parseTailLimit defaults and clamps to a small safe range", () => {
  assert.equal(parseTailLimit(undefined), 20);
  assert.equal(parseTailLimit("0"), 1);
  assert.equal(parseTailLimit("5"), 5);
  assert.equal(parseTailLimit("500"), 50);
  assert.equal(parseTailLimit("nope"), 20);
});

test("compactStartupNoise collapses repeated startup boilerplate", () => {
  const actual = compactStartupNoise([
    "",
    "> solto@1.0.0 start /home/agent/solto",
    "> tsx --env-file=.env src/server.ts",
    "solto running on :3000",
    "  GET  /health",
    "[webhook] hit /webhook/mobile-app",
    "[webhook] ignored comment (no bot mention command)",
  ]);

  assert.deepEqual(actual, [
    "[startup noise omitted: 5 lines]",
    "[webhook] hit /webhook/mobile-app",
    "[webhook] ignored comment (no bot mention command)",
  ]);
});

test("selectLatestErrorEntries returns the latest matching error lines", () => {
  const actual = selectLatestErrorEntries([
    "stack frame 1",
    "Error: Transform failed with 1 error:",
    "stack frame 2",
    "fatal: repository not found",
    "stack frame 3",
    "[mobile-app/123] Failed: Error: boom",
  ], 2);

  assert.deepEqual(actual, [
    "Error: Transform failed with 1 error:",
    "[mobile-app/123] Failed: Error: boom",
  ]);
});
