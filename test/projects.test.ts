import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectByLinearProjectId,
  issueBelongsToProject,
} from "../src/project-routing.ts";
import { resolveLinearWebhookSecret } from "../src/project-secrets.ts";

test("resolveLinearWebhookSecret prefers repo-local secret", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "solto-project-secret-"));
  const previousShared = process.env.LINEAR_WEBHOOK_SECRET;
  process.env.LINEAR_WEBHOOK_SECRET = "shared-secret";
  await writeFile(join(repoPath, ".env"), "LINEAR_WEBHOOK_SECRET=repo-secret\n");
  try {
    assert.equal(resolveLinearWebhookSecret(repoPath), "repo-secret");
  } finally {
    if (previousShared === undefined) delete process.env.LINEAR_WEBHOOK_SECRET;
    else process.env.LINEAR_WEBHOOK_SECRET = previousShared;
  }
});

test("resolveLinearWebhookSecret falls back to shared secret", () => {
  const previousShared = process.env.LINEAR_WEBHOOK_SECRET;
  process.env.LINEAR_WEBHOOK_SECRET = "shared-secret";
  try {
    assert.equal(resolveLinearWebhookSecret("/tmp/does-not-exist"), "shared-secret");
  } finally {
    if (previousShared === undefined) delete process.env.LINEAR_WEBHOOK_SECRET;
    else process.env.LINEAR_WEBHOOK_SECRET = previousShared;
  }
});

test("issueBelongsToProject requires an exact linearProjectId match", () => {
  assert.equal(
    issueBelongsToProject({ linearProjectId: "project-1" }, "project-1"),
    true
  );
  assert.equal(
    issueBelongsToProject({ linearProjectId: "project-1" }, "project-2"),
    false
  );
  assert.equal(
    issueBelongsToProject({ linearProjectId: "project-1" }, null),
    false
  );
});

test("findProjectByLinearProjectId resolves the matching managed project", () => {
  const project = findProjectByLinearProjectId(
    [
      { id: "mobile-app", linearProjectId: "project-1" },
      { id: "www", linearProjectId: "project-2" },
    ],
    "project-2"
  );
  assert.deepEqual(project, { id: "www", linearProjectId: "project-2" });
  assert.equal(findProjectByLinearProjectId([], "project-2"), null);
  assert.equal(findProjectByLinearProjectId([{ id: "x", linearProjectId: "p" }], null), null);
});
