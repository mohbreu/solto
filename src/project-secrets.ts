import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readEnvFileValue(envPath: string, key: string): string {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const currentKey = trimmed.slice(0, eq).trim();
      if (currentKey !== key) continue;
      return trimmed.slice(eq + 1).trim();
    }
  } catch {
    return "";
  }
  return "";
}

export function resolveLinearWebhookSecret(repoPath: string): string {
  const repoSecret = readEnvFileValue(resolve(repoPath, ".env"), "LINEAR_WEBHOOK_SECRET");
  return repoSecret || process.env.LINEAR_WEBHOOK_SECRET || "";
}
