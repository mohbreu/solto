import crypto from "node:crypto";

export interface GitHubPullRequestWebhook {
  action?: string;
  repository?: {
    full_name?: string;
  };
  pull_request?: {
    html_url?: string;
    merged?: boolean;
  };
}

export function verifyGitHubWebhook(
  signature: string | null,
  rawBody: string,
  secret: string
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return crypto.timingSafeEqual(provided, wanted);
}
