import test from "node:test";
import assert from "node:assert/strict";
import { buildPullRequestAttachmentInput } from "../src/linear.ts";

test("buildPullRequestAttachmentInput formats open pull requests", () => {
  assert.deepEqual(
    buildPullRequestAttachmentInput(
      "https://github.com/karrin-app/mobile-app/pull/25"
    ),
    {
      title: "Pull Request #25",
      subtitle: "Open",
      url: "https://github.com/karrin-app/mobile-app/pull/25",
    }
  );
});

test("buildPullRequestAttachmentInput formats merged pull requests", () => {
  assert.deepEqual(
    buildPullRequestAttachmentInput(
      "https://github.com/karrin-app/mobile-app/pull/25",
      "merged"
    ),
    {
      title: "Pull Request #25",
      subtitle: "Merged",
      url: "https://github.com/karrin-app/mobile-app/pull/25",
    }
  );
});

test("buildPullRequestAttachmentInput falls back when the URL has no PR number", () => {
  assert.deepEqual(
    buildPullRequestAttachmentInput("https://github.com/karrin-app/mobile-app"),
    {
      title: "Pull Request",
      subtitle: "Open",
      url: "https://github.com/karrin-app/mobile-app",
    }
  );
});
