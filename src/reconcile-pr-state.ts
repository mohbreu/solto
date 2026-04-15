import { exec } from "./exec.js";
import {
  STATE_DONE,
  getIssueById,
  postLinearComment,
  setIssueState,
  syncPullRequestAttachment,
} from "./linear.js";
import { PROJECTS } from "./projects.js";
import {
  deletePullRequestState,
  listPullRequestStates,
  type PullRequestState,
} from "./pr-state.js";
import { parsePullRequestNumber } from "./reconcile-utils.js";

interface GitHubPullRequestDetails {
  state: string;
  merged_at: string | null;
  html_url: string;
  number: number;
}

async function getPullRequestDetails(
  repo: string,
  number: number
): Promise<GitHubPullRequestDetails> {
  const raw = await exec("gh", ["api", `repos/${repo}/pulls/${number}`]);
  const parsed = JSON.parse(raw) as Partial<GitHubPullRequestDetails>;
  return {
    state: typeof parsed.state === "string" ? parsed.state : "unknown",
    merged_at: typeof parsed.merged_at === "string" ? parsed.merged_at : null,
    html_url: typeof parsed.html_url === "string" ? parsed.html_url : "",
    number: typeof parsed.number === "number" ? parsed.number : number,
  };
}

async function reconcileEntry(
  entry: PullRequestState,
  dryRun: boolean
): Promise<{ status: "kept" | "reconciled" | "pruned" | "skipped"; reason?: string }> {
  const project = PROJECTS[entry.projectId];
  if (!project) {
    return { status: "skipped", reason: `unknown project ${entry.projectId}` };
  }

  const prNumber = parsePullRequestNumber(entry.prUrl);
  if (!prNumber) {
    return { status: "skipped", reason: `could not parse PR number from ${entry.prUrl}` };
  }

  const details = await getPullRequestDetails(project.githubRepo, prNumber);
  if (details.state !== "closed") {
    return { status: "kept", reason: `PR is still ${details.state}` };
  }

  if (details.merged_at) {
    const issue = await getIssueById(entry.issueId);
    if (!issue) {
      return { status: "skipped", reason: `missing Linear issue ${entry.issueId}` };
    }

    if (!dryRun) {
      await syncPullRequestAttachment(issue.id, entry.prUrl, "merged").catch((err) => {
        console.error(`[reconcile] failed to sync PR attachment for ${issue.id}:`, err);
      });
      if (issue.stateName !== STATE_DONE) {
        await postLinearComment(
          issue.id,
          `PR merged: ${entry.prUrl}\n\nMarking the Linear issue as Done.`
        );
        await setIssueState(issue.id, issue.teamId, STATE_DONE);
      }
    }

    if (!dryRun) {
      await deletePullRequestState(entry.issueId);
    }
    return {
      status: "reconciled",
      reason:
        issue.stateName === STATE_DONE
          ? `PR merged and issue already done`
          : `PR merged and issue moved to Done`,
    };
  }

  if (!dryRun) {
    await deletePullRequestState(entry.issueId);
  }
  return { status: "pruned", reason: "closed without merge" };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const entries = await listPullRequestStates();
  let exitCode = 0;

  console.log(
    `[reconcile] scanning ${entries.length} PR state entr${entries.length === 1 ? "y" : "ies"}${dryRun ? " (dry run)" : ""}`
  );

  for (const entry of entries) {
    try {
      const result = await reconcileEntry(entry, dryRun);
      const prefix = `[reconcile] ${entry.projectId}/${entry.issueId}`;
      if (result.reason) {
        console.log(`${prefix} ${result.status}: ${result.reason}`);
      } else {
        console.log(`${prefix} ${result.status}`);
      }
    } catch (err) {
      exitCode = 1;
      console.error(
        `[reconcile] failed for ${entry.projectId}/${entry.issueId}:`,
        err
      );
    }
  }

  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[reconcile] fatal error:", err);
    process.exitCode = 1;
  });
}
