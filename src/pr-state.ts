import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PullRequestState {
  issueId: string;
  projectId: string;
  branch: string;
  base: string;
  prUrl: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = resolve(ROOT, ".solto-state", "prs");

function statePathFor(issueId: string): string {
  return resolve(STATE_DIR, `${issueId}.json`);
}

export async function getPullRequestState(
  issueId: string
): Promise<PullRequestState | null> {
  const raw = await readFile(statePathFor(issueId), "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as PullRequestState;
}

export async function savePullRequestState(
  entry: PullRequestState
): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    statePathFor(entry.issueId),
    JSON.stringify(entry, null, 2) + "\n",
    "utf8"
  );
}

export async function deletePullRequestState(issueId: string): Promise<void> {
  await rm(statePathFor(issueId), { force: true }).catch(() => {});
}
