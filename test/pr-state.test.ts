import test from "node:test";
import assert from "node:assert/strict";

import {
  deletePullRequestState,
  getPullRequestState,
  savePullRequestState,
} from "../src/pr-state.ts";
import { cleanupState, uniqueIssueId } from "./helpers.ts";

test("savePullRequestState round-trips persisted PR metadata", async () => {
  const issueId = uniqueIssueId("test-pr");

  await cleanupState("prs", [issueId]);

  const expected = {
    issueId,
    projectId: "mobile-app",
    branch: "feat/MOBILE-123-add-tests",
    base: "main",
    prUrl: "https://github.com/example/repo/pull/123",
  };

  await savePullRequestState(expected);

  const actual = await getPullRequestState(issueId);
  assert.deepEqual(actual, expected);

  await deletePullRequestState(issueId);
  assert.equal(await getPullRequestState(issueId), null);
});
