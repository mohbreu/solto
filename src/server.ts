import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
import { runAgent } from "./agent.js";
import {
  getIssueById,
  getIssueStateName,
  postLinearComment,
  STATE_TODO,
  type LinearComment,
  verifyLinearWebhook,
  type LinearIssue,
} from "./linear.js";
import { getPullRequestState } from "./pr-state.js";
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
const COMMENT_COMMAND_RE = /^\/agent(?:\s+([\s\S]*))?$/i;

function normalizeStateName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

function isTodoStateName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalizeStateName(name);
  return normalized === normalizeStateName(STATE_TODO) || normalized === "todo";
}

function parseAgentCommentCommand(body: string): string | null {
  const match = body.trim().match(COMMENT_COMMAND_RE);
  if (!match) return null;
  return match[1]?.trim() || "Address the latest feedback on the existing PR.";
}

function issueIsValid(issue: LinearIssue): boolean {
  return ISSUE_ID_RE.test(issue.id) && ISSUE_IDENTIFIER_RE.test(issue.identifier);
}

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

  if (webhookType === "Issue") {
    const labels = (data?.labels ?? []) as { id: string; name: string }[];
    const labelNames = labels.map((l) => l.name);
    const issue = data as LinearIssue;
    console.log(
      `[webhook] ${projectId} type=${webhookType} action=${action} issue=${data?.id} labels=[${labelNames.join(",")}]`
    );

    if (!issueIsValid(issue)) {
      console.log(`[webhook] rejected malformed issue id/identifier: ${issue.id}/${issue.identifier}`);
      return c.text("Bad Request", 400);
    }

    const agentLabel = labels.find((l) => l.name === "agent");
    if (!agentLabel) {
      console.log(`[webhook] ignored (no agent label)`);
      return c.text("OK");
    }

    if (action === "create") {
      const stateName = await getIssueStateName(issue.id).catch((err) => {
        console.error(`[webhook] failed to fetch issue state for ${projectId}/${issue.id}:`, err);
        return null;
      });
      if (!isTodoStateName(stateName)) {
        console.log(
          `[webhook] ignored (action=create but state is not todo: ${stateName ?? "unknown"})`
        );
        return c.text("OK");
      }
    } else if (action === "update") {
      const prevLabelIds = updatedFrom?.labelIds as string[] | undefined;
      if (prevLabelIds === undefined) {
        console.log(`[webhook] ignored (labels did not change in this event)`);
        return c.text("OK");
      }
      if (prevLabelIds.includes(agentLabel.id)) {
        console.log(`[webhook] ignored (agent label was already present)`);
        return c.text("OK");
      }
    } else {
      console.log(`[webhook] ignored (action=${action})`);
      return c.text("OK");
    }

    const direct = labels.some((l) => l.name === "yolo");
    const prefixed = labelNames
      .find((n) => n.startsWith("type:"))
      ?.slice("type:".length);
    const bare = labelNames.find((n) => CONVENTIONAL_TYPES.has(n));
    const type = prefixed || bare || "chore";

    return await acceptRun(projectId, project, issue, {
      direct,
      type,
    });
  }

  if (webhookType === "Comment") {
    const comment = data as LinearComment;
    const issueId = comment.issueId;
    const instruction = parseAgentCommentCommand(comment.body ?? "");
    console.log(
      `[webhook] ${projectId} type=${webhookType} action=${action} issue=${issueId} comment=${comment.id}`
    );

    if (action !== "create") {
      console.log(`[webhook] ignored comment (action=${action})`);
      return c.text("OK");
    }
    if (!instruction) {
      console.log("[webhook] ignored comment (no /agent command)");
      return c.text("OK");
    }

    const existingPr = await getPullRequestState(issueId);
    if (!existingPr || existingPr.projectId !== projectId) {
      console.log(`[webhook] ignored comment (no existing solto PR for issue ${issueId})`);
      return c.text("OK");
    }

    const issue = await getIssueById(issueId).catch((err) => {
      console.error(`[webhook] failed to fetch issue details for ${projectId}/${issueId}:`, err);
      return null;
    });
    if (!issue) {
      console.log(`[webhook] ignored comment (issue lookup failed for ${issueId})`);
      return c.text("OK");
    }
    if (!issueIsValid(issue)) {
      console.log(`[webhook] rejected malformed issue from comment lookup: ${issue.id}/${issue.identifier}`);
      return c.text("Bad Request", 400);
    }

    return await acceptRun(projectId, project, issue, {
      type: existingPr.branch.split("/", 1)[0] || "chore",
      existingPr,
      followUpInstruction: instruction,
    });
  }

  console.log(`[webhook] ignored (type=${webhookType})`);
  return c.text("OK");
});

async function acceptRun(
  projectId: string,
  project: (typeof PROJECTS)[string],
  issue: LinearIssue,
  opts: {
    direct?: boolean;
    type?: string;
    existingPr?: Awaited<ReturnType<typeof getPullRequestState>>;
    followUpInstruction?: string;
  }
) {
  const workers = pools.get(projectId)!;

  if (workers.has(issue.id)) {
    console.log(`[${projectId}] ${issue.id} already running, ignoring`);
    return new Response("Already running", { status: 200 });
  }

  if (workers.size >= project.maxParallel) {
    console.log(`[${projectId}] Max parallel reached, dropping ${issue.id}`);
    return new Response("Too Many Requests", { status: 429 });
  }

  const limitReason = checkLimits(projectId);
  if (limitReason) {
    console.log(`[${projectId}] ${limitReason}, dropping ${issue.id}`);
    await postLinearComment(
      issue.id,
      `Agent skipped: ${limitReason}. Try again later.`
    ).catch(() => {});
    return new Response("Rate limited", { status: 429 });
  }

  history.get(projectId)!.push(Date.now());

  const worker = runAgent(issue, project, {
    direct: opts.direct,
    type: opts.type,
    existingPr: opts.existingPr ?? undefined,
    followUpInstruction: opts.followUpInstruction,
  }).finally(() => {
    workers.delete(issue.id);
  });

  workers.set(issue.id, worker);

  console.log(`[${projectId}] Accepted ${issue.id} - active: ${workers.size}/${project.maxParallel}`);

  return new Response("Accepted", { status: 202 });
}

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log("solto running on :3000");
  Object.keys(PROJECTS).forEach((id) => {
    console.log(`  POST /webhook/${id}`);
  });
  console.log("  GET  /status  (x-status-token header required)");
  console.log("  GET  /health");
});
