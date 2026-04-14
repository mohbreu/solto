import test from "node:test";
import assert from "node:assert/strict";
import { envKeyFor } from "../src/project-ids.ts";

test("envKeyFor uppercases and normalizes dashed ids", async () => {
  assert.equal(envKeyFor("mobile-app"), "MOBILE_APP");
  assert.equal(envKeyFor("api"), "API");
});

test("envKeyFor rejects invalid project ids", async () => {
  assert.throws(() => envKeyFor("Mobile-App"), /Invalid project id/);
  assert.throws(() => envKeyFor("mobile_app"), /Invalid project id/);
});
