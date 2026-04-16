import test from "node:test";
import assert from "node:assert/strict";

import { parsePullRequestNumber } from "../src/reconcile-utils.ts";

test("parsePullRequestNumber extracts the PR number from a GitHub URL", () => {
  assert.equal(
    parsePullRequestNumber("https://github.com/example/repo/pull/123"),
    123
  );
});

test("parsePullRequestNumber rejects non-PR URLs", () => {
  assert.equal(
    parsePullRequestNumber("https://github.com/example/repo/issues/123"),
    null
  );
});
