import test from "node:test";
import assert from "node:assert/strict";

import {
  deletePullRequestState,
  listPullRequestStates,
  getPullRequestState,
  savePullRequestState,
} from "../src/pr-state.ts";
import { cleanupStateDir, uniqueIssueId } from "./helpers.ts";

test("savePullRequestState round-trips persisted PR metadata", async () => {
  const issueId = uniqueIssueId("test-pr");

  await cleanupStateDir("prs");

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

test("listPullRequestStates returns entries in a stable order", async () => {
  const issueA = uniqueIssueId("test-pr-a");
  const issueB = uniqueIssueId("test-pr-b");

  await cleanupStateDir("prs");

  await savePullRequestState({
    issueId: issueB,
    projectId: "zeta",
    branch: "feat/zeta",
    base: "main",
    prUrl: "https://github.com/example/repo/pull/2",
  });
  await savePullRequestState({
    issueId: issueA,
    projectId: "alpha",
    branch: "feat/alpha",
    base: "main",
    prUrl: "https://github.com/example/repo/pull/1",
  });

  const entries = await listPullRequestStates();
  const projectIds = entries.map((entry) => entry.projectId);
  const issueIds = entries.map((entry) => entry.issueId);

  assert.deepEqual(projectIds.slice(0, 2), ["alpha", "zeta"]);
  assert.deepEqual(issueIds.slice(0, 2), [issueA, issueB]);

  await deletePullRequestState(issueA);
  await deletePullRequestState(issueB);
});
