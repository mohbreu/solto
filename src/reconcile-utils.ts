export function parsePullRequestNumber(prUrl: string): number | null {
  try {
    const path = new URL(prUrl).pathname.replace(/\/+$/, "");
    const match = path.match(/\/pull\/(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
