import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export function uniqueIssueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function cleanupState(kind: "prs" | "runs", issueIds: string[]): Promise<void> {
  const dir = resolve(process.cwd(), ".solto-state", kind);
  await Promise.all(
    issueIds.map((issueId) =>
      rm(resolve(dir, `${issueId}.json`), { force: true }).catch(() => {})
    )
  );
}
