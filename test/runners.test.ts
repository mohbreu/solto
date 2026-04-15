import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfiguredCoder,
  resolveClaudeSubagentMode,
  selectCoder,
} from "../src/runners.ts";

test("normalizeConfiguredCoder accepts auto", () => {
  assert.equal(normalizeConfiguredCoder("auto"), "auto");
  assert.equal(normalizeConfiguredCoder(undefined), "codex");
});

test("selectCoder prefers claude in auto mode when available", () => {
  assert.equal(
    selectCoder("auto", { preferClaude: true, claudeAvailable: true }),
    "claude"
  );
  assert.equal(
    selectCoder("auto", { preferClaude: true, claudeAvailable: false }),
    "codex"
  );
});

test("resolveClaudeSubagentMode escalates auto mode for complex tasks", () => {
  const previous = process.env.CLAUDE_ENABLE_SUBAGENTS;
  process.env.CLAUDE_ENABLE_SUBAGENTS = "1";
  try {
    assert.equal(resolveClaudeSubagentMode(undefined, false), "standard");
    assert.equal(resolveClaudeSubagentMode(undefined, true), "aggressive");
    assert.equal(resolveClaudeSubagentMode("standard", true), "standard");
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_ENABLE_SUBAGENTS;
    else process.env.CLAUDE_ENABLE_SUBAGENTS = previous;
  }
});
