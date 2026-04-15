import test from "node:test";
import assert from "node:assert/strict";
import { findMatchingPullRequest } from "../src/pr-recovery.ts";

test("findMatchingPullRequest matches a single open PR by issue identifier in branch", () => {
  const match = findMatchingPullRequest("SLT-11", [
    {
      url: "https://github.com/example/repo/pull/11",
      headRefName: "feat/SLT-11-setup-clerk-auth",
      baseRefName: "main",
      state: "OPEN",
    },
  ]);

  assert.equal(match?.url, "https://github.com/example/repo/pull/11");
});

test("findMatchingPullRequest returns null when multiple branches match the same issue", () => {
  const match = findMatchingPullRequest("SLT-11", [
    {
      url: "https://github.com/example/repo/pull/11",
      headRefName: "feat/SLT-11-setup-clerk-auth",
      baseRefName: "main",
      state: "OPEN",
    },
    {
      url: "https://github.com/example/repo/pull/12",
      headRefName: "fix/SLT-11-cleanup",
      baseRefName: "main",
      state: "OPEN",
    },
  ]);

  assert.equal(match, null);
});
