import { mkdir, readFile, rm } from "node:fs/promises";
import { buildChangeSummary } from "./change-summary.js";
import { exec, execSilent } from "./exec.js";
import {
  postLinearComment,
  setIssueState,
  STATE_DONE,
  STATE_IN_PROGRESS,
  STATE_IN_REVIEW,
  STATE_TODO,
  type LinearIssue,
} from "./linear.js";
import {
  deletePullRequestState,
  savePullRequestState,
  type PullRequestState,
} from "./pr-state.js";
import type { ProjectConfig } from "./projects.js";
import { redactSecrets } from "./redact.js";
import { getJobState, saveJobState } from "./run-state.js";
import { CODER_DISPLAY_NAMES, runCoder } from "./runners.js";

interface RunAgentOptions {
  direct?: boolean;
  type?: string;
  existingPr?: PullRequestState;
  followUpInstruction?: string;
}

export async function runAgent(
  issue: LinearIssue,
  project: ProjectConfig,
  opts: RunAgentOptions = {}
) {
  const type = opts.type ?? "chore";
  const branch = opts.existingPr?.branch
    ?? `${type}/${issue.identifier}-${slugify(issue.title)}`;
  const base = opts.existingPr?.base ?? project.githubBase;
  const worktree = `${project.workersPath}/${issue.id}`;
  const prFile = `/tmp/solto-pr-${issue.id}.md`;
  const isIteration = Boolean(opts.existingPr);
  const initialRunState = await getJobState(issue.id).catch(() => null);
  const startedAt = initialRunState?.startedAt ?? new Date().toISOString();
  const mode = opts.direct ? "direct" : isIteration ? "iteration" : "pr";
  let terminalState:
    | { status: "succeeded" | "direct" | "no_changes" | "failed"; prUrl?: string; error?: string }
    | null = null;

  console.log(`[${project.id}/${issue.id}] Starting: ${issue.title}`);

  try {
    await postLinearComment(
      issue.id,
      isIteration
        ? `Agent started updating the existing PR for: ${issue.title}`
        : `Agent started on task: ${issue.title}`
    );
    await setIssueState(issue.id, issue.teamId, STATE_IN_PROGRESS);

    await mkdir(project.workersPath, { recursive: true });
    await prepareWorktree(project, worktree, branch, base, isIteration);

    await saveJobState({
      issueId: issue.id,
      projectId: project.id,
      title: issue.title,
      mode,
      status: "running",
      phase: "workspace_ready",
      startedAt,
      updatedAt: new Date().toISOString(),
      prUrl: opts.existingPr?.prUrl,
    });

    await postLinearComment(issue.id, "Workspace ready. Running agent.");
    const coder = await runCoder(
      buildPrompt(issue, type, {
        prFile,
        followUpInstruction: opts.followUpInstruction,
        existingPrUrl: opts.existingPr?.prUrl,
      }),
      worktree
    );
    await postLinearComment(issue.id, `${CODER_DISPLAY_NAMES[coder]} finished.`);

    const diff = await exec("git", [
      "-C", worktree, "diff", "--stat", `origin/${base}`,
    ]).catch(() => "");
    const changedFiles = await exec("git", [
      "-C", worktree, "diff", "--name-only", `origin/${base}`,
    ]).catch(() => "");
    const numstat = await exec("git", [
      "-C", worktree, "diff", "--numstat", `origin/${base}`,
    ]).catch(() => "");
    const hasChanges = diff.trim().length > 0;
    const summary = summarizeDiff(changedFiles, numstat);

    if (!hasChanges) {
      const now = new Date().toISOString();
      await saveJobState({
        issueId: issue.id,
        projectId: project.id,
        title: issue.title,
        mode,
        status: "no_changes",
        phase: "finished",
        startedAt,
        updatedAt: now,
        finishedAt: now,
        prUrl: opts.existingPr?.prUrl,
      });
      terminalState = { status: "no_changes", prUrl: opts.existingPr?.prUrl };
      await postLinearComment(
        issue.id,
        "Agent finished but made no changes. The task may already be complete or the description needs more detail."
      );
      await setIssueState(
        issue.id,
        issue.teamId,
        isIteration ? STATE_IN_REVIEW : STATE_TODO
      );
      return;
    }

    const uncommitted = await exec("git", [
      "-C", worktree, "status", "--porcelain",
    ]).catch(() => "");
    if (uncommitted.trim().length > 0) {
      await exec("git", ["-C", worktree, "add", "-A"]);
      await exec("git", [
        "-C", worktree,
        "commit", "-m", `${type}: ${issue.title}`,
      ]);
    }

    if (opts.direct) {
      await exec("git", [
        "-C", worktree,
        "push", "origin", `HEAD:${base}`,
      ]);

      const now = new Date().toISOString();
      await saveJobState({
        issueId: issue.id,
        projectId: project.id,
        title: issue.title,
        mode: "direct",
        status: "direct",
        phase: "finished",
        startedAt,
        updatedAt: now,
        finishedAt: now,
      });
      terminalState = { status: "direct" };
      await postLinearComment(
        issue.id,
        `Done. Pushed directly to ${base} (yolo).\n\n${summary}\n\nDiff:\n${diff.trim()}`
      );
      await setIssueState(issue.id, issue.teamId, STATE_DONE);
      await deletePullRequestState(issue.id);

      console.log(`[${project.id}/${issue.id}] Done - direct push to ${base}`);
      return;
    }

    await exec("git", [
      "-C", worktree,
      "push", "--force-with-lease", "origin", branch,
    ]);

    if (isIteration) {
      const prUrl = opts.existingPr!.prUrl;
      await savePullRequestState({
        issueId: issue.id,
        projectId: project.id,
        branch,
        base,
        prUrl,
      });
      const now = new Date().toISOString();
      await saveJobState({
        issueId: issue.id,
        projectId: project.id,
        title: issue.title,
        mode: "iteration",
        status: "succeeded",
        phase: "finished",
        startedAt,
        updatedAt: now,
        finishedAt: now,
        prUrl,
      });
      terminalState = { status: "succeeded", prUrl };
      await postLinearComment(
        issue.id,
        `Done. Updated PR: ${prUrl}\n\n${summary}\n\nDiff:\n${diff.trim()}`
      );
      await setIssueState(issue.id, issue.teamId, STATE_IN_REVIEW);

      console.log(`[${project.id}/${issue.id}] Done - updated PR: ${prUrl}`);
      return;
    }

    const { title: prTitle, body: prBody } = await readPrMeta(
      prFile,
      type,
      issue.title
    );

    const prOutput = await exec(
      "gh",
      [
        "pr", "create",
        "--title", prTitle,
        "--body", prBody,
        "--base", base,
        "--head", branch,
      ],
      { cwd: worktree }
    );

    const prUrl = prOutput.trim().split("\n").pop() ?? prOutput.trim();
    await savePullRequestState({
      issueId: issue.id,
      projectId: project.id,
      branch,
      base,
      prUrl,
    });

    const now = new Date().toISOString();
    await saveJobState({
      issueId: issue.id,
      projectId: project.id,
      title: issue.title,
      mode: "pr",
      status: "succeeded",
      phase: "finished",
      startedAt,
      updatedAt: now,
      finishedAt: now,
      prUrl,
    });
    terminalState = { status: "succeeded", prUrl };
    await postLinearComment(
      issue.id,
      `Done. PR opened: ${prUrl}\n\n${summary}\n\nDiff:\n${diff.trim()}`
    );
    await setIssueState(issue.id, issue.teamId, STATE_IN_REVIEW);

    console.log(`[${project.id}/${issue.id}] Done - PR: ${prUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const redactedMessage = redactSecrets(message);
    const now = new Date().toISOString();

    await saveJobState({
      issueId: issue.id,
      projectId: project.id,
      title: issue.title,
      mode,
      status: "failed",
      phase: "failed",
      startedAt,
      updatedAt: now,
      finishedAt: now,
      prUrl: opts.existingPr?.prUrl,
      error: redactedMessage,
    }).catch(() => {});
    terminalState = {
      status: "failed",
      prUrl: opts.existingPr?.prUrl,
      error: redactedMessage,
    };

    await postLinearComment(issue.id, `Agent failed.\n\n${redactedMessage}`).catch(() => {});
    await setIssueState(
      issue.id,
      issue.teamId,
      isIteration ? STATE_IN_REVIEW : STATE_TODO
    ).catch(() => {});
    if (!isIteration) {
      await deletePullRequestState(issue.id).catch(() => {});
    }

    console.error(`[${project.id}/${issue.id}] Failed:`, err);
  } finally {
    if (terminalState) {
      const now = new Date().toISOString();
      await saveJobState({
        issueId: issue.id,
        projectId: project.id,
        title: issue.title,
        mode,
        status: terminalState.status,
        phase: "finished",
        startedAt,
        updatedAt: now,
        finishedAt: now,
        prUrl: terminalState.prUrl,
        error: terminalState.error,
      }).catch(() => {});
    }
    await execSilent("git", [
      "-C", project.repoPath,
      "worktree", "remove", worktree, "--force",
    ]);
    await execSilent("git", [
      "-C", project.repoPath,
      "branch", "-D", branch,
    ]);
    await rm(prFile, { force: true }).catch(() => {});
  }
}

function summarizeDiff(changedFiles: string, numstat: string): string {
  const files = changedFiles
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.trim().split(/\s+/, 3);
    additions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }

  return buildChangeSummary(files, additions, deletions);
}

async function prepareWorktree(
  project: ProjectConfig,
  worktree: string,
  branch: string,
  base: string,
  isIteration: boolean
): Promise<void> {
  if (isIteration) {
    await exec("git", ["-C", project.repoPath, "fetch", "origin", branch]);
    await exec("git", [
      "-C", project.repoPath,
      "branch", "-f", branch,
      `origin/${branch}`,
    ]);
    await exec("git", [
      "-C", project.repoPath,
      "worktree", "add", worktree,
      branch,
    ]);
    return;
  }

  await exec("git", ["-C", project.repoPath, "fetch", "origin", base]);
  await execSilent("git", [
    "-C", project.repoPath,
    "worktree", "remove", worktree, "--force",
  ]);
  await execSilent("git", [
    "-C", project.repoPath,
    "worktree", "prune",
  ]);
  await execSilent("git", [
    "-C", project.repoPath,
    "branch", "-D", branch,
  ]);
  await exec("git", [
    "-C", project.repoPath,
    "worktree", "add", worktree,
    "-b", branch,
    `origin/${base}`,
  ]);
}

async function readPrMeta(
  path: string,
  type: string,
  fallbackTitle: string
): Promise<{ title: string; body: string }> {
  const raw = await readFile(path, "utf8").catch(() => "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      title: `${type}: ${fallbackTitle}`,
      body: "_Agent did not provide a PR description._",
    };
  }
  const [firstLine, ...rest] = trimmed.split("\n");
  const title = firstLine.trim();
  const body = rest.join("\n").trim();
  return {
    title: title || `${type}: ${fallbackTitle}`,
    body: body || "_Agent did not provide a PR description._",
  };
}

function buildPrompt(
  issue: LinearIssue,
  type: string,
  opts: {
    prFile: string;
    followUpInstruction?: string;
    existingPrUrl?: string;
  }
): string {
  const followUpBlock = opts.followUpInstruction?.trim()
    ? `Follow-up request from a new Linear comment:
${opts.followUpInstruction.trim()}

`
    : "";
  const existingPrBlock = opts.existingPrUrl
    ? `Existing PR:
${opts.existingPrUrl}

`
    : "";
  const modeInstruction = opts.existingPrUrl
    ? "Update the existing PR branch to address the follow-up request"
    : "Complete the task fully without asking for clarification";
  const prMetadataBlock = opts.existingPrUrl
    ? `PR metadata:
- Do not create a new PR
- Do not change the branch name
- Update the existing PR with one or more new commits as needed`
    : `PR metadata:
- After committing, write a short PR title and body to: ${opts.prFile}
- Format: first line = title, blank line, then body.
- Title MUST follow Conventional Commits, type "${type}", and describe
  the ACTUAL change you made (not the ticket title).
  Example: "${type}: remove maestro step from CI workflow"
- Body should summarize the actual diff and why: 1 to 3 short paragraphs
  or a tight bulleted list. No ticket IDs, no "Resolves:" references,
  and no self-attribution.`;

  return `
You are an autonomous software agent working on a real codebase.

Task: ${issue.title}

Details:
${issue.description}

${followUpBlock}${existingPrBlock}Instructions:
- ${modeInstruction}
- Read AGENTS.md at the repo root FIRST and follow every rule in it
  (style, commit format, attribution, dependency policy, workflow). It
  takes precedence over your defaults.
- If your runtime supports delegation or subagents, proactively use them
  for independent research, bounded implementation slices, or review.
  Keep the final result integrated in this same worktree and branch.
  Do not create extra branches or PRs.
- Follow existing code conventions in the repo
- Run the test suite if one exists and fix any failures you introduce
- Only modify files directly relevant to this task
- Make reasonable assumptions where the spec is ambiguous
- Stage and commit your changes yourself, following AGENTS.md commit rules
  (Conventional Commits, imperative mood, no self-attribution). Do NOT
  push; solto handles pushing and PR creation.

${prMetadataBlock}
`.trim();
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
