import test from "node:test";
import assert from "node:assert/strict";
import { buildBranchName } from "../src/agent.ts";

test("buildBranchName truncates long titles cleanly", () => {
  assert.equal(
    buildBranchName(
      "feat",
      "SLT-16",
      "Add a password visibility toggle to the login screen for mobile users"
    ),
    "feat/SLT-16-add-a-password-visibility-toggle-to-the"
  );
});

test("buildBranchName trims dangling dashes after truncation", () => {
  assert.equal(
    buildBranchName(
      "feat",
      "SLT-16",
      "Add a password visibility toggle to the!!!"
    ),
    "feat/SLT-16-add-a-password-visibility-toggle-to-the"
  );
});

test("buildBranchName strips leading and trailing punctuation", () => {
  assert.equal(
    buildBranchName("fix", "SLT-20", "!!! Maestro Tests ???"),
    "fix/SLT-20-maestro-tests"
  );
});
