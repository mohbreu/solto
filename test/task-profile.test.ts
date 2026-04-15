import test from "node:test";
import assert from "node:assert/strict";
import { assessTaskProfile } from "../src/task-profile.ts";

test("assessTaskProfile marks short focused work as simple", () => {
  const profile = assessTaskProfile({
    id: "1",
    identifier: "SLT-1",
    title: "Fix typo in README",
    description: "Update one sentence in README.md.",
    teamId: "team",
    stateName: "Todo",
    assigneeId: "bot",
  });

  assert.equal(profile.complexity, "simple");
  assert.equal(profile.preferClaude, false);
  assert.equal(profile.aggressiveDelegation, false);
});

test("assessTaskProfile marks broad follow-up work as complex", () => {
  const profile = assessTaskProfile(
    {
      id: "2",
      identifier: "SLT-2",
      title: "Refactor auth workflow across app and docs",
      description: [
        "- Update src/auth/session.ts",
        "- Update src/server.ts",
        "- Update README.md",
        "- Add tests",
      ].join("\n"),
      teamId: "team",
      stateName: "Todo",
      assigneeId: "bot",
    },
    {
      followUpInstruction:
        "Address review feedback, rerun integration tests, and tighten the CI workflow.",
      existingPrUrl: "https://github.com/mohbreu/solto/pull/1",
    }
  );

  assert.equal(profile.complexity, "complex");
  assert.equal(profile.preferClaude, true);
  assert.equal(profile.aggressiveDelegation, true);
  assert.match(profile.signals.join(","), /follow_up_iteration/);
});
