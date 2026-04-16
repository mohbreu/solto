import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCoderRuntimeLabel,
  formatExecutionSummary,
  parseAgentRunMetadata,
} from "../src/run-metadata.ts";

test("parseAgentRunMetadata reads subagent and review details", () => {
  const metadata = parseAgentRunMetadata(`{
    "subagentsUsed": true,
    "subagentCount": 3,
    "reviewCompleted": true,
    "reviewSummary": "Reviewer pass found one small cleanup and it was fixed."
  }`);

  assert.deepEqual(metadata, {
    subagentsUsed: true,
    subagentCount: 3,
    reviewCompleted: true,
    reviewSummary: "Reviewer pass found one small cleanup and it was fixed.",
  });
});

test("formatExecutionSummary renders coder, subagents, and review", () => {
  const summary = formatExecutionSummary(
    {
      coder: "claude",
      claudeSubagentMode: "aggressive",
      model: "claude-sonnet-4-5",
      version: "1.2.3",
    },
    {
      subagentsUsed: true,
      subagentCount: 2,
      reviewCompleted: true,
      reviewSummary: "Reviewer pass found no remaining correctness issues.",
    }
  );

  assert.match(summary, /Runtime: claude-code@1.2.3 \(claude-sonnet-4-5\)/);
  assert.match(summary, /Claude subagent mode: aggressive/);
  assert.match(summary, /Subagents used: 2/);
  assert.match(summary, /Final review: completed/);
  assert.match(summary, /Review notes: Reviewer pass found no remaining correctness issues\./);
});

test("formatCoderRuntimeLabel omits model when it is not pinned", () => {
  assert.equal(
    formatCoderRuntimeLabel({
      coder: "codex",
      claudeSubagentMode: "off",
      model: "not pinned",
      version: "0.121.0",
    }),
    "codex-cli@0.121.0"
  );
});
