import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
import { runAgent } from "./agent.js";
import {
  postLinearComment,
  verifyLinearWebhook,
  type LinearIssue,
} from "./linear.js";
import { PROJECTS } from "./projects.js";

const CONVENTIONAL_TYPES = new Set([
  "feat", "fix", "chore", "docs", "refactor",
  "test", "style", "perf", "build", "ci", "revert",
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const ISSUE_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const ISSUE_IDENTIFIER_RE = /^[A-Z0-9]+-[0-9]+$/;

function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const app = new Hono();

const pools = new Map(
  Object.keys(PROJECTS).map((id) => [id, new Map<string, Promise<void>>()])
);

const history = new Map<string, number[]>(
  Object.keys(PROJECTS).map((id) => [id, []])
);

function checkLimits(projectId: string): string | null {
  const project = PROJECTS[projectId];
  const list = history.get(projectId)!;
  const now = Date.now();
  while (list.length && list[0] < now - DAY_MS) list.shift();
  const lastHour = list.filter((t) => t > now - HOUR_MS).length;
  if (lastHour >= project.maxPerHour) {
    return `hourly cap reached (${project.maxPerHour}/hr)`;
  }
  if (list.length >= project.maxPerDay) {
    return `daily cap reached (${project.maxPerDay}/day)`;
  }
  return null;
}

app.get("/status", (c) => {
  if (!tokensMatch(c.req.header("x-status-token"), process.env.STATUS_TOKEN ?? "")) {
    return c.text("Unauthorized", 401);
  }

  const now = Date.now();
  const status = Object.fromEntries(
    [...pools.entries()].map(([projectId, workers]) => {
      const list = history.get(projectId)!;
      const lastHour = list.filter((t) => t > now - HOUR_MS).length;
      const lastDay = list.filter((t) => t > now - DAY_MS).length;
      const project = PROJECTS[projectId];
      return [
        projectId,
        {
          active: workers.size,
          max: project.maxParallel,
          jobs: [...workers.keys()],
          runs: {
            lastHour: `${lastHour}/${project.maxPerHour}`,
            lastDay: `${lastDay}/${project.maxPerDay}`,
          },
        },
      ];
    })
  );

  return c.json(status);
});

app.get("/health", (c) => c.text("ok"));

app.post("/webhook/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = PROJECTS[projectId];

  console.log(`[webhook] hit /webhook/${projectId}`);

  if (!project) {
    console.log(`[webhook] unknown project: ${projectId}`);
    return c.text("Unknown project", 404);
  }

  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return c.text("Payload too large", 413);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) {
    return c.text("Payload too large", 413);
  }
  const signature = c.req.header("linear-signature") ?? null;

  if (!verifyLinearWebhook(signature, raw, project.webhookSecret)) {
    console.log(`[webhook] signature verification FAILED for ${projectId}`);
    return c.text("Unauthorized", 401);
  }

  const body = JSON.parse(raw);
  const { action, type: webhookType, data, updatedFrom } = body;

  const labels = (data?.labels ?? []) as { id: string; name: string }[];
  const labelNames = labels.map((l) => l.name);
  console.log(
    `[webhook] ${projectId} type=${webhookType} action=${action} issue=${data?.id} labels=[${labelNames.join(",")}]`
  );

  if (action !== "update") {
    console.log(`[webhook] ignored (action=${action})`);
    return c.text("OK");
  }

  const agentLabel = labels.find((l) => l.name === "agent");
  if (!agentLabel) {
    console.log(`[webhook] ignored (no agent label)`);
    return c.text("OK");
  }

  const prevLabelIds = updatedFrom?.labelIds as string[] | undefined;
  if (prevLabelIds === undefined) {
    console.log(`[webhook] ignored (labels did not change in this event)`);
    return c.text("OK");
  }
  if (prevLabelIds.includes(agentLabel.id)) {
    console.log(`[webhook] ignored (agent label was already present)`);
    return c.text("OK");
  }

  const direct = labels.some((l) => l.name === "yolo");
  const prefixed = labelNames
    .find((n) => n.startsWith("type:"))
    ?.slice("type:".length);
  const bare = labelNames.find((n) => CONVENTIONAL_TYPES.has(n));
  const type = prefixed || bare || "chore";

  const workers = pools.get(projectId)!;
  const issue = data as LinearIssue;

  if (!ISSUE_ID_RE.test(issue.id) || !ISSUE_IDENTIFIER_RE.test(issue.identifier)) {
    console.log(`[webhook] rejected malformed issue id/identifier: ${issue.id}/${issue.identifier}`);
    return c.text("Bad Request", 400);
  }

  if (workers.has(issue.id)) {
    console.log(`[${projectId}] ${issue.id} already running, ignoring`);
    return c.text("Already running", 200);
  }

  if (workers.size >= project.maxParallel) {
    console.log(`[${projectId}] Max parallel reached, dropping ${issue.id}`);
    return c.text("Too Many Requests", 429);
  }

  const limitReason = checkLimits(projectId);
  if (limitReason) {
    console.log(`[${projectId}] ${limitReason}, dropping ${issue.id}`);
    await postLinearComment(
      issue.id,
      `Agent skipped: ${limitReason}. Try again later.`
    ).catch(() => {});
    return c.text("Rate limited", 429);
  }

  history.get(projectId)!.push(Date.now());

  const worker = runAgent(issue, project, { direct, type }).finally(() => {
    workers.delete(issue.id);
  });

  workers.set(issue.id, worker);

  console.log(`[${projectId}] Accepted ${issue.id} - active: ${workers.size}/${project.maxParallel}`);

  return c.text("Accepted", 202);
});

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log("solto running on :3000");
  Object.keys(PROJECTS).forEach((id) => {
    console.log(`  POST /webhook/${id}`);
  });
  console.log("  GET  /status  (x-status-token header required)");
  console.log("  GET  /health");
});
