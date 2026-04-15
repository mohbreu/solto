import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfiguredCoder,
  planCoderRun,
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

test("planCoderRun reports claude subagent mode", () => {
  const previousCoder = process.env.CODER;
  const previousEnable = process.env.CLAUDE_ENABLE_SUBAGENTS;
  const previousMode = process.env.CLAUDE_SUBAGENT_MODE;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.CODER = "claude";
  process.env.CLAUDE_ENABLE_SUBAGENTS = "1";
  process.env.CLAUDE_SUBAGENT_MODE = "standard";
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    assert.deepEqual(planCoderRun({ aggressiveDelegation: true }), {
      coder: "claude",
      claudeSubagentMode: "standard",
    });
  } finally {
    if (previousCoder === undefined) delete process.env.CODER;
    else process.env.CODER = previousCoder;
    if (previousEnable === undefined) delete process.env.CLAUDE_ENABLE_SUBAGENTS;
    else process.env.CLAUDE_ENABLE_SUBAGENTS = previousEnable;
    if (previousMode === undefined) delete process.env.CLAUDE_SUBAGENT_MODE;
    else process.env.CLAUDE_SUBAGENT_MODE = previousMode;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
