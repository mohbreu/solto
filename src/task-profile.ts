import type { LinearIssue } from "./linear.js";

export interface TaskProfile {
  complexity: "simple" | "complex";
  preferClaude: boolean;
  aggressiveDelegation: boolean;
  signals: string[];
}

interface AssessTaskProfileOptions {
  followUpInstruction?: string;
  existingPrUrl?: string;
}

const COMPLEXITY_KEYWORDS = [
  /\brefactor/i,
  /\bmigrat(?:e|ion)/i,
  /\breview feedback\b/i,
  /\bperformance\b/i,
  /\bperf\b/i,
  /\bintegration\b/i,
  /\be2e\b/i,
  /\bworkflow\b/i,
  /\bci\b/i,
  /\bauth\b/i,
  /\bclerk\b/i,
  /\boauth\b/i,
  /\bdeploy(?:ment)?\b/i,
  /\bacross\b/i,
  /\bmultiple\b/i,
  /\bseveral\b/i,
  /\bparallel\b/i,
] as const;

const FILE_PATH_PATTERN =
  /\b(?:[\w-]+\/)+[\w.-]+\.[A-Za-z0-9]{2,}\b/g;

export function assessTaskProfile(
  issue: LinearIssue,
  opts: AssessTaskProfileOptions = {}
): TaskProfile {
  const text = [
    issue.title,
    issue.description,
    opts.followUpInstruction ?? "",
  ].join("\n");
  const signals: string[] = [];
  let score = 0;

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 140 || text.length >= 900) {
    score += 1;
    signals.push("long_spec");
  }

  const bulletCount = text
    .split("\n")
    .filter((line) => /^(\s*[-*]|\s*\d+\.)/.test(line))
    .length;
  if (bulletCount >= 4) {
    score += 1;
    signals.push("multi_step_scope");
  }

  const fileMatches = new Set(text.match(FILE_PATH_PATTERN) ?? []);
  if (fileMatches.size >= 2) {
    score += 1;
    signals.push("multiple_file_areas");
  }

  const keywordHits = COMPLEXITY_KEYWORDS.filter((pattern) => pattern.test(text));
  if (keywordHits.length >= 2) {
    score += 1;
    signals.push("complex_keywords");
  }

  if (opts.followUpInstruction?.trim()) {
    score += 1;
    signals.push("follow_up_iteration");
  }

  if (opts.existingPrUrl) {
    score += 1;
    signals.push("existing_pr_context");
  }

  const complexity = score >= 2 ? "complex" : "simple";
  return {
    complexity,
    preferClaude: complexity === "complex",
    aggressiveDelegation: complexity === "complex",
    signals,
  };
}
