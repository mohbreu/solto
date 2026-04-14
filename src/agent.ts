import { exec, execSilent } from "./exec.js";
import {
  postLinearComment,
  setIssueState,
  STATE_IN_PROGRESS,
  STATE_IN_REVIEW,
  STATE_TODO,
  STATE_DONE,
} from "./linear.js";
import type { LinearIssue } from "./linear.js";
import type { ProjectConfig } from "./projects.js";
import { mkdir, readFile, rm } from "node:fs/promises";
import { runCoder, CODER_DISPLAY_NAMES } from "./runners.js";

export async function runAgent(
  issue: LinearIssue,
  project: ProjectConfig,
  opts: { direct?: boolean; type?: string } = {}
) {
  const type = opts.type ?? "chore";
  const branch = `${type}/${issue.identifier}-${slugify(issue.title)}`;
  const worktree = `${project.workersPath}/${issue.id}`;
  const prFile = `/tmp/solto-pr-${issue.id}.md`;

  console.log(`[${project.id}/${issue.id}] Starting: ${issue.title}`);

  try {
    await postLinearComment(
      issue.id,
      `Agent started on task: ${issue.title}`
    );
    await setIssueState(issue.id, issue.teamId, STATE_IN_PROGRESS);

    await mkdir(project.workersPath, { recursive: true });
    await exec("git", ["-C", project.repoPath, "fetch", "origin", project.githubBase]);
    await exec("git", [
      "-C", project.repoPath,
      "worktree", "add", worktree,
      "-b", branch,
      `origin/${project.githubBase}`,
    ]);

    await postLinearComment(issue.id, "Workspace ready. Running agent.");
    const coder = await runCoder(buildPrompt(issue, type, prFile), worktree);
    await postLinearComment(
      issue.id,
      `${CODER_DISPLAY_NAMES[coder]} finished.`
    );

    const diff = await exec("git", [
      "-C", worktree, "diff", "--stat", `origin/${project.githubBase}`,
    ]).catch(() => "");
    const hasChanges = diff.trim().length > 0;

    if (!hasChanges) {
      await postLinearComment(
        issue.id,
        "Agent finished but made no changes. The task may already be complete or the description needs more detail."
      );
      await setIssueState(issue.id, issue.teamId, STATE_TODO);
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
        "push", "origin", `HEAD:${project.githubBase}`,
      ]);

      await postLinearComment(
        issue.id,
        `Done. Pushed directly to ${project.githubBase} (yolo).\n\n${diff.trim()}`
      );
      await setIssueState(issue.id, issue.teamId, STATE_DONE);

      console.log(`[${project.id}/${issue.id}] Done - direct push to ${project.githubBase}`);
      return;
    }

    await exec("git", [
      "-C", worktree,
      "push", "--force-with-lease", "origin", branch,
    ]);

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
        "--base", project.githubBase,
        "--head", branch,
      ],
      { cwd: worktree }
    );

    const url = prOutput.trim().split("\n").pop() ?? prOutput.trim();

    await postLinearComment(
      issue.id,
      `Done. PR opened: ${url}\n\n${diff.trim()}`
    );
    await setIssueState(issue.id, issue.teamId, STATE_IN_REVIEW);

    console.log(`[${project.id}/${issue.id}] Done - PR: ${url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await postLinearComment(
      issue.id,
      `Agent failed.\n\n${message}`
    ).catch(() => {});
    await setIssueState(issue.id, issue.teamId, STATE_TODO).catch(() => {});

    console.error(`[${project.id}/${issue.id}] Failed:`, err);
  } finally {
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
  prFile: string
): string {
  return `
You are an autonomous software agent working on a real codebase.

Task: ${issue.title}

Details:
${issue.description}

Instructions:
- Read AGENTS.md at the repo root FIRST and follow every rule in it
  (style, commit format, attribution, dependency policy, workflow). It
  takes precedence over your defaults.
- Complete the task fully without asking for clarification
- Follow existing code conventions in the repo
- Run the test suite if one exists and fix any failures you introduce
- Only modify files directly relevant to this task
- Make reasonable assumptions where the spec is ambiguous
- Stage and commit your changes yourself, following AGENTS.md commit rules
  (Conventional Commits, imperative mood, no self-attribution). Do NOT
  push — solto handles pushing and PR creation.

PR metadata:
- After committing, write a short PR title and body to: ${prFile}
- Format: first line = title, blank line, then body.
- Title MUST follow Conventional Commits, type "${type}", and describe
  the ACTUAL change you made (not the ticket title).
  Example: "${type}: remove maestro step from CI workflow"
- Body should summarize the actual diff and why — 1-3 short paragraphs
  or a tight bulleted list. No ticket IDs, no "Resolves:" references,
  no self-attribution.
`.trim();
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
