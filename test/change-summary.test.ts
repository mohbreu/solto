import test from "node:test";
import assert from "node:assert/strict";
import { buildChangeSummary } from "../src/change-summary.ts";

test("buildChangeSummary includes file count, line counts, and main areas", () => {
  const summary = buildChangeSummary(
    [
      "src/server.ts",
      "src/agent.ts",
      "test/change-summary.test.ts",
      "README.md",
    ],
    120,
    18
  );

  assert.match(summary, /Updated 4 files with about \+120 \/ -18 lines changed\./);
  assert.match(summary, /Main touched areas were src\/server\.ts|src\/agent\.ts|src\/server and src\/agent/);
  assert.match(summary, /test changes/i);
  assert.match(summary, /Documentation was updated/i);
});

test("buildChangeSummary handles a single changed file", () => {
  const summary = buildChangeSummary(["package.json"], 4, 1);

  assert.match(summary, /Updated 1 file with about \+4 \/ -1 lines changed\./);
  assert.match(summary, /Dependency or package metadata changed/i);
});
