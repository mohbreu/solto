import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { runAgent } from "./agent.js";
import {
  type GitHubPullRequestWebhook,
  verifyGitHubWebhook,
} from "./github.js";
import {
  getIssueById,
  getViewer,
  getViewerId,
  postLinearComment,
  setIssueState,
  STATE_DONE,
  STATE_TODO,
  type LinearComment,
  verifyLinearWebhook,
  type LinearIssue,
} from "./linear.js";
import {
  deletePullRequestState,
  findPullRequestStateByUrl,
  getPullRequestState,
} from "./pr-state.js";
import { PROJECTS } from "./projects.js";
import {
  listRecentJobStates,
  markAllRunningJobsInterrupted,
  saveJobState,
} from "./run-state.js";
import {
  compactStartupNoise,
  dedupeSequential,
  parseTailLimit,
  selectLatestErrorEntries,
} from "./status-logs.js";

const execFileAsync = promisify(execFile);

const CONVENTIONAL_TYPES = new Set([
  "feat", "fix", "chore", "docs", "refactor",
  "test", "style", "perf", "build", "ci", "revert",
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const STATUS_LOG_SCAN_MULTIPLIERS = [4, 8, 16, 32];
const ISSUE_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const ISSUE_IDENTIFIER_RE = /^[A-Z0-9]+-[0-9]+$/;
const PM2_HOME = process.env.PM2_HOME || path.join(process.env.HOME || "", ".pm2");

interface ProcessSummary {
  status: string;
  pid: number | null;
  uptimeSec: number | null;
  restarts: number | null;
  memoryMb: number | null;
  cpuPct: number | null;
}

async function getProcessStats(): Promise<Record<string, ProcessSummary> | null> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"]);
    const parsed = JSON.parse(stdout) as Array<{
      name?: string;
      pid?: number;
      monit?: { memory?: number; cpu?: number };
      pm2_env?: {
        status?: string;
        pm_uptime?: number;
        restart_time?: number;
      };
    }>;
    const names = new Set(["solto", "cloudflare-tunnel"]);
    const now = Date.now();
    return Object.fromEntries(
      parsed
        .filter((proc) => proc.name && names.has(proc.name))
        .map((proc) => [
          proc.name!,
          {
            status: proc.pm2_env?.status ?? "unknown",
            pid: typeof proc.pid === "number" ? proc.pid : null,
            uptimeSec: proc.pm2_env?.pm_uptime
              ? Math.max(0, Math.floor((now - proc.pm2_env.pm_uptime) / 1000))
              : null,
            restarts: typeof proc.pm2_env?.restart_time === "number"
              ? proc.pm2_env.restart_time
              : null,
            memoryMb: typeof proc.monit?.memory === "number"
              ? Number((proc.monit.memory / (1024 * 1024)).toFixed(1))
              : null,
            cpuPct: typeof proc.monit?.cpu === "number"
              ? Number(proc.monit.cpu.toFixed(1))
              : null,
          },
        ])
    );
  } catch (err) {
    console.error("[status] failed to read pm2 process stats:", err);
    return null;
  }
}

async function readLogWindow(filePath: string, maxLines: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("tail", ["-n", String(maxLines), filePath]);
    return stdout.trimEnd().split("\n");
  } catch {
    return [];
  }
}

async function collectProcessedTail(
  filePath: string,
  maxLines: number,
  processLines: (lines: string[], limit: number) => string[],
  hasEnough: (lines: string[]) => boolean
): Promise<string[]> {
  let last: string[] = [];

  for (const multiplier of STATUS_LOG_SCAN_MULTIPLIERS) {
    const window = maxLines * multiplier;
    const raw = await readLogWindow(filePath, window);
    if (raw.length === 0) continue;

    last = processLines(dedupeSequential(raw), maxLines).slice(-maxLines);
    if (hasEnough(last)) return last;
  }

  return last;
}

async function getStatusLogs(maxLines: number): Promise<Record<string, string[]>> {
  const hasRealOutput = (lines: string[]) =>
    lines.some((line) => line.trim().length > 0 && !line.startsWith("[startup noise omitted:"));
  const hasAnyLines = (lines: string[]) => lines.length > 0;

  return {
    soltoOutTail: await collectProcessedTail(
      path.join(PM2_HOME, "logs", "solto-out.log"),
      maxLines,
      (lines, limit) => compactStartupNoise(lines).slice(-limit),
      hasRealOutput
    ),
    soltoErrorTail: await collectProcessedTail(
      path.join(PM2_HOME, "logs", "solto-error.log"),
      maxLines,
      selectLatestErrorEntries,
      hasAnyLines
    ),
    tunnelErrorTail: await collectProcessedTail(
      path.join(PM2_HOME, "logs", "cloudflare-tunnel-error.log"),
      maxLines,
      selectLatestErrorEntries,
      hasAnyLines
    ),
  };
}
function normalizeStateName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

function isTodoStateName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalizeStateName(name);
  return normalized === normalizeStateName(STATE_TODO) || normalized === "todo";
}

function buildBotMentionAliases(name: string): string[] {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  const aliases = new Set<string>([
    normalized,
    normalized.replace(/\s+/g, "-"),
    normalized.replace(/\s+/g, "_"),
  ]);

  const configured = process.env.LINEAR_BOT_MENTION?.trim().toLowerCase();
  if (configured) aliases.add(configured.replace(/^@/, ""));

  return [...aliases];
}

function parseBotMentionComment(body: string, aliases: string[]): string | null {
  const trimmed = body.trim();
  for (const alias of aliases) {
    const prefix = `@${alias}`;
    if (!trimmed.toLowerCase().startsWith(prefix)) continue;

    const remainder = trimmed.slice(prefix.length).trim();
    return remainder || "Address the latest feedback on the existing PR.";
  }

  return null;
}

function issueIsValid(issue: LinearIssue): boolean {
  return ISSUE_ID_RE.test(issue.id) && ISSUE_IDENTIFIER_RE.test(issue.identifier);
}

function getPreviousAssigneeId(updatedFrom: unknown): string | null {
  if (!updatedFrom || typeof updatedFrom !== "object") return null;

  const record = updatedFrom as {
    assigneeId?: unknown;
    assignee?: { id?: unknown } | null;
  };

  if (typeof record.assigneeId === "string") {
    return record.assigneeId;
  }
  if (record.assignee && typeof record.assignee.id === "string") {
    return record.assignee.id;
  }
  return null;
}

function updateTouchedAssigneeOrState(updatedFrom: unknown): boolean {
  if (!updatedFrom || typeof updatedFrom !== "object") return false;

  const record = updatedFrom as {
    assigneeId?: unknown;
    assignee?: unknown;
    stateId?: unknown;
    state?: unknown;
  };

  return (
    Object.hasOwn(record, "assigneeId")
    || Object.hasOwn(record, "assignee")
    || Object.hasOwn(record, "stateId")
    || Object.hasOwn(record, "state")
  );
}

async function getAssignmentTriggerIssue(
  projectId: string,
  issueId: string,
  action: string,
  updatedFrom: unknown
): Promise<{ issue: LinearIssue | null; reason?: string; feedback?: string }> {
  const issue = await getIssueById(issueId).catch((err) => {
    console.error(
      `[webhook] failed to fetch issue details for ${projectId}/${issueId}:`,
      err
    );
    return null;
  });
  if (!issue) {
    return { issue: null, reason: `issue lookup failed for ${issueId}` };
  }

  const viewerId = await getViewerId().catch((err) => {
    console.error(`[webhook] failed to fetch Linear viewer id for ${projectId}:`, err);
    return null;
  });
  if (!viewerId) {
    return { issue: null, reason: "unable to resolve bot user" };
  }

  if (issue.assigneeId !== viewerId) {
    const touchedAssigneeOrState = action === "update" && updateTouchedAssigneeOrState(updatedFrom);
    return {
      issue: null,
      reason: "issue is not assigned to the bot user",
      feedback: touchedAssigneeOrState && isTodoStateName(issue.stateName)
        ? "Ignored: this issue is in Todo, but it is not assigned to the bot user. Assign it to the bot to start work."
        : undefined,
    };
  }

  if (!isTodoStateName(issue.stateName)) {
    return {
      issue: null,
      reason: `state is not todo: ${issue.stateName ?? "unknown"}`,
      feedback: `Ignored: this issue is assigned to the bot user, but its current state is ${issue.stateName ?? "unknown"}. Move it to Todo / To do to start work.`,
    };
  }

  if (action === "create") {
    return { issue };
  }

  if (action === "update") {
    const prevAssigneeId = getPreviousAssigneeId(updatedFrom);
    const touchedAssigneeOrState = updateTouchedAssigneeOrState(updatedFrom);
    if (!touchedAssigneeOrState) {
      return { issue: null, reason: "assignee/state did not change in this event" };
    }
    if (prevAssigneeId === viewerId && !Object.hasOwn(updatedFrom as object, "stateId")) {
      return { issue: null, reason: "issue was already assigned to the bot user" };
    }
    return { issue };
  }

  return { issue: null, reason: `action=${action}` };
}

function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function findProjectByRepo(fullName: string | undefined) {
  if (!fullName) return null;
  const normalized = fullName.toLowerCase();
  return Object.values(PROJECTS).find(
    (project) => project.githubRepo.toLowerCase() === normalized
  ) ?? null;
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
    const issueFromWebhook = data as LinearIssue;
    console.log(
      `[webhook] ${projectId} type=${webhookType} action=${action} issue=${data?.id} labels=[${labelNames.join(",")}]`
    );

    if (!issueIsValid(issueFromWebhook)) {
      console.log(
        `[webhook] rejected malformed issue id/identifier: ${issueFromWebhook.id}/${issueFromWebhook.identifier}`
      );
      return c.text("Bad Request", 400);
    }

    const { issue, reason, feedback } = await getAssignmentTriggerIssue(
      projectId,
      issueFromWebhook.id,
      action,
      updatedFrom
    );
    if (!issue) {
      console.log(`[webhook] ignored (${reason ?? "not eligible"})`);
      if (feedback) {
        await postLinearComment(issueFromWebhook.id, feedback).catch(() => {});
      }
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
    console.log(
      `[webhook] ${projectId} type=${webhookType} action=${action} issue=${issueId} comment=${comment.id}`
    );

    if (action !== "create") {
      console.log(`[webhook] ignored comment (action=${action})`);
      return c.text("OK");
    }
    const viewer = await getViewer().catch((err) => {
      console.error(`[webhook] failed to fetch Linear viewer for ${projectId}:`, err);
      return null;
    });
    if (!viewer) {
      console.log("[webhook] ignored comment (unable to resolve bot user)");
      return c.text("OK");
    }
    const instruction = parseBotMentionComment(
      comment.body ?? "",
      buildBotMentionAliases(viewer.name)
    );
    if (!instruction) {
      console.log("[webhook] ignored comment (no bot mention command)");
      return c.text("OK");
    }

    const existingPr = await getPullRequestState(issueId);
    if (!existingPr || existingPr.projectId !== projectId) {
      console.log(`[webhook] ignored comment (no existing solto PR for issue ${issueId})`);
      await postLinearComment(
        issueId,
        "Ignored bot request: no existing solto-managed PR is associated with this issue yet."
      ).catch(() => {});
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

app.post("/github-webhook", async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!secret) {
    console.log("[github-webhook] ignored (GITHUB_WEBHOOK_SECRET is unset)");
    return c.text("Not configured", 503);
  }

  const raw = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  if (!verifyGitHubWebhook(signature, raw, secret)) {
    console.log("[github-webhook] signature verification FAILED");
    return c.text("Unauthorized", 401);
  }

  const event = c.req.header("x-github-event") ?? "";
  if (event !== "pull_request") {
    console.log(`[github-webhook] ignored (event=${event || "unknown"})`);
    return c.text("OK");
  }

  const body = JSON.parse(raw) as GitHubPullRequestWebhook;
  const project = findProjectByRepo(body.repository?.full_name);
  const prUrl = body.pull_request?.html_url;
  console.log(
    `[github-webhook] event=${event} action=${body.action ?? "unknown"} repo=${body.repository?.full_name ?? "unknown"} pr=${prUrl ?? "unknown"}`
  );

  if (body.action !== "closed" || body.pull_request?.merged !== true || !prUrl) {
    console.log("[github-webhook] ignored (not a merged pull request)");
    return c.text("OK");
  }
  if (!project) {
    console.log("[github-webhook] ignored (repo not managed by solto)");
    return c.text("OK");
  }

  const prState = await findPullRequestStateByUrl(prUrl);
  if (!prState || prState.projectId !== project.id) {
    console.log(`[github-webhook] ignored (no matching solto PR state for ${prUrl})`);
    return c.text("OK");
  }

  const issue = await getIssueById(prState.issueId).catch((err) => {
    console.error(`[github-webhook] failed to fetch issue ${prState.issueId}:`, err);
    return null;
  });
  if (!issue) {
    console.log(`[github-webhook] ignored (issue lookup failed for ${prState.issueId})`);
    return c.text("OK");
  }

  await postLinearComment(
    issue.id,
    `PR merged: ${prUrl}\n\nMarking the Linear issue as Done.`
  ).catch((err) => {
    console.error(`[github-webhook] failed to post merge comment for ${issue.id}:`, err);
  });
  await setIssueState(issue.id, issue.teamId, STATE_DONE);
  await deletePullRequestState(issue.id);

  console.log(`[github-webhook] marked ${issue.id} done after merge: ${prUrl}`);
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
  const nowIso = new Date().toISOString();
  await saveJobState({
    issueId: issue.id,
    projectId,
    title: issue.title,
    mode: opts.direct ? "direct" : opts.existingPr ? "iteration" : "pr",
    status: "running",
    phase: "accepted",
    startedAt: nowIso,
    updatedAt: nowIso,
    prUrl: opts.existingPr?.prUrl,
  }).catch(() => {});

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

app.get("/status", async (c) => {
  if (!tokensMatch(c.req.header("x-status-token"), process.env.STATUS_TOKEN ?? "")) {
    return c.text("Unauthorized", 401);
  }

  const now = Date.now();
  const include = new Set(
    (c.req.query("include") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const logTail = parseTailLimit(c.req.query("tail"));
  const recentJobs = await listRecentJobStates(12);
  const processStats = await getProcessStats();
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

  const payload: Record<string, unknown> = {
    ...status,
    _recent: recentJobs,
    _process: processStats,
    _generatedAt: new Date().toISOString(),
  };

  if (include.has("logs")) {
    payload._logs = await getStatusLogs(logTail);
  }

  return c.json(payload);
});

async function main(): Promise<void> {
  await markAllRunningJobsInterrupted();

  serve({ fetch: app.fetch, port: 3000 }, () => {
    console.log("solto running on :3000");
    Object.keys(PROJECTS).forEach((id) => {
      console.log(`  POST /webhook/${id}`);
    });
    console.log("  POST /github-webhook");
    console.log("  GET  /status  (x-status-token header required)");
    console.log("  GET  /health");
  });
}

void main();
