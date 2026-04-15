import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestState } from "./pr-state.js";

const execFileAsync = promisify(execFile);

interface GitHubPullSummary {
  url: string;
  headRefName: string;
  baseRefName: string;
  state: string;
}

export function findMatchingPullRequest(
  issueIdentifier: string,
  pulls: GitHubPullSummary[]
): GitHubPullSummary | null {
  const branchPattern = new RegExp(
    `^[^/]+/${issueIdentifier}(?:-|$)`,
    "i"
  );
  const matches = pulls.filter((pull) => branchPattern.test(pull.headRefName));
  return matches.length === 1 ? matches[0] : null;
}

export async function recoverPullRequestState(
  issueId: string,
  issueIdentifier: string,
  projectId: string,
  githubRepo: string
): Promise<PullRequestState | null> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "pr",
      "list",
      "--repo",
      githubRepo,
      "--state",
      "open",
      "--json",
      "url,headRefName,baseRefName,state",
      "--limit",
      "100",
    ]);
    const pulls = JSON.parse(stdout) as GitHubPullSummary[];
    const match = findMatchingPullRequest(issueIdentifier, pulls);
    if (!match) return null;
    return {
      issueId,
      projectId,
      branch: match.headRefName,
      base: match.baseRefName,
      prUrl: match.url,
    };
  } catch {
    return null;
  }
}
