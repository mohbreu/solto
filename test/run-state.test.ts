import test from "node:test";
import assert from "node:assert/strict";

import {
  getJobState,
  listRecentJobStates,
  markAllRunningJobsInterrupted,
  saveJobState,
} from "../src/run-state.ts";
import { cleanupState, uniqueIssueId } from "./helpers.ts";

test("listRecentJobStates sorts by updatedAt descending", async () => {
  const issueA = uniqueIssueId("test-run-a");
  const issueB = uniqueIssueId("test-run-b");

  await cleanupState("runs", [issueA, issueB]);

  await saveJobState({
    issueId: issueA,
    projectId: "mobile-app",
    title: "Older job",
    mode: "pr",
    status: "succeeded",
    phase: "finished",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  });

  await saveJobState({
    issueId: issueB,
    projectId: "mobile-app",
    title: "Newer job",
    mode: "iteration",
    status: "failed",
    phase: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
    finishedAt: "2026-01-01T00:02:00.000Z",
    error: "boom",
  });

  const recent = await listRecentJobStates(100);
  const ids = recent
    .filter((job) => job.issueId === issueA || job.issueId === issueB)
    .map((job) => job.issueId);

  assert.deepEqual(ids, [issueB, issueA]);

  await cleanupState("runs", [issueA, issueB]);
});

test("markAllRunningJobsInterrupted only changes running jobs", async () => {
  const runningIssue = uniqueIssueId("test-running");
  const doneIssue = uniqueIssueId("test-done");

  await cleanupState("runs", [runningIssue, doneIssue]);

  await saveJobState({
    issueId: runningIssue,
    projectId: "mobile-app",
    title: "Running job",
    mode: "pr",
    status: "running",
    phase: "workspace_ready",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:30.000Z",
  });

  await saveJobState({
    issueId: doneIssue,
    projectId: "mobile-app",
    title: "Done job",
    mode: "direct",
    status: "direct",
    phase: "finished",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  });

  await markAllRunningJobsInterrupted();

  const running = await getJobState(runningIssue);
  const done = await getJobState(doneIssue);

  assert.equal(running?.status, "interrupted");
  assert.equal(running?.phase, "interrupted");
  assert.equal(running?.error, "solto restarted while the job was running");
  assert.ok(running?.finishedAt);

  assert.equal(done?.status, "direct");
  assert.equal(done?.phase, "finished");

  await cleanupState("runs", [runningIssue, doneIssue]);
});
