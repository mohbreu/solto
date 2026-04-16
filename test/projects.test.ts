import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
