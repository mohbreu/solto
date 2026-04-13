import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type JobStatus =
  | "running"
  | "succeeded"
  | "direct"
  | "no_changes"
  | "failed"
  | "interrupted";

export interface JobState {
  issueId: string;
  projectId: string;
  title: string;
  mode: "pr" | "direct" | "iteration";
  status: JobStatus;
  phase: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  prUrl?: string;
  error?: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = resolve(ROOT, ".solto-state", "runs");

function statePathFor(issueId: string): string {
  return resolve(STATE_DIR, `${issueId}.json`);
}

function byUpdatedDesc(a: JobState, b: JobState): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export async function saveJobState(entry: JobState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    statePathFor(entry.issueId),
    JSON.stringify(entry, null, 2) + "\n",
    "utf8"
  );
}

export async function getJobState(issueId: string): Promise<JobState | null> {
  const raw = await readFile(statePathFor(issueId), "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as JobState;
}

export async function listJobStates(): Promise<JobState[]> {
  const names = await readdir(STATE_DIR).catch(() => [] as string[]);
  const jobs = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const raw = await readFile(resolve(STATE_DIR, name), "utf8").catch(() => "");
        if (!raw.trim()) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as JobState;
      })
  );

  return jobs.filter((job): job is JobState => job !== null).sort(byUpdatedDesc);
}

export async function listRecentJobStates(limit = 10): Promise<JobState[]> {
  return (await listJobStates()).slice(0, limit);
}

export async function markAllRunningJobsInterrupted(): Promise<void> {
  const jobs = await listJobStates();
  const now = new Date().toISOString();

  await Promise.all(
    jobs
      .filter((job) => job.status === "running")
      .map((job) =>
        saveJobState({
          ...job,
          status: "interrupted",
          phase: "interrupted",
          updatedAt: now,
          finishedAt: now,
          error: "solto restarted while the job was running",
        })
      )
  );
}
