import type { Coder } from "./runners.js";

export interface AgentRunMetadata {
  subagentsUsed: boolean | null;
  subagentCount: number | null;
  reviewCompleted: boolean;
  reviewSummary: string | null;
}

export interface RunPlanSummary {
  coder: Coder;
  claudeSubagentMode: "off" | "standard" | "aggressive";
}

export function parseAgentRunMetadata(raw: string): AgentRunMetadata | null {
  if (!raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as {
      subagentsUsed?: unknown;
      subagentCount?: unknown;
      reviewCompleted?: unknown;
      reviewSummary?: unknown;
    };

    const subagentsUsed =
      typeof parsed.subagentsUsed === "boolean" ? parsed.subagentsUsed : null;
    const subagentCount =
      typeof parsed.subagentCount === "number" && parsed.subagentCount >= 0
        ? Math.floor(parsed.subagentCount)
        : null;
    const reviewCompleted = parsed.reviewCompleted === true;
    const reviewSummary = normalizeReviewSummary(parsed.reviewSummary);

    return {
      subagentsUsed,
      subagentCount,
      reviewCompleted,
      reviewSummary,
    };
  } catch {
    return null;
  }
}

export function normalizeReviewSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > 400 ? `${cleaned.slice(0, 397)}...` : cleaned;
}

export function formatExecutionSummary(
  plan: RunPlanSummary,
  metadata: AgentRunMetadata | null
): string {
  const lines = [`Execution:`, `- Coder: ${displayCoder(plan.coder)}`];

  if (plan.coder === "claude") {
    lines.push(`- Claude subagent mode: ${plan.claudeSubagentMode}`);
  }

  if (metadata?.subagentsUsed === true) {
    lines.push(
      `- Subagents used: ${metadata.subagentCount ?? "reported but count missing"}`
    );
  } else if (metadata?.subagentsUsed === false) {
    lines.push("- Subagents used: no");
  } else {
    lines.push("- Subagents used: not reported");
  }

  if (metadata?.reviewCompleted) {
    lines.push(`- Final review: completed`);
    if (metadata.reviewSummary) {
      lines.push(`- Review notes: ${metadata.reviewSummary}`);
    }
  } else {
    lines.push("- Final review: not reported");
  }

  return lines.join("\n");
}

function displayCoder(coder: Coder): string {
  return coder === "claude" ? "Claude Code" : "Codex";
}
