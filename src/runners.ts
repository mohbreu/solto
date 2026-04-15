import { exec } from "./exec.js";

export type Coder = "claude" | "codex";
export type ConfiguredCoder = Coder | "auto";

interface RunCoderOptions {
  preferClaude?: boolean;
  aggressiveDelegation?: boolean;
}

type ClaudeSubagentMode = "off" | "standard" | "aggressive";

const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 20 * 60 * 1000);

export function normalizeConfiguredCoder(
  value: string | undefined
): ConfiguredCoder {
  const normalized = (value ?? "codex").toLowerCase();
  if (
    normalized === "claude"
    || normalized === "codex"
    || normalized === "auto"
  ) {
    return normalized;
  }
  throw new Error(
    `Unknown CODER: ${normalized} (expected "codex", "claude", or "auto")`
  );
}

export function selectCoder(
  configured: ConfiguredCoder,
  opts: { preferClaude?: boolean; claudeAvailable?: boolean } = {}
): Coder {
  if (configured !== "auto") return configured;
  if (opts.preferClaude && opts.claudeAvailable !== false) {
    return "claude";
  }
  return "codex";
}

export function resolveClaudeSubagentMode(
  value: string | undefined,
  aggressiveRequested: boolean
): ClaudeSubagentMode {
  const enabled = !["0", "false", "no"].includes(
    (process.env.CLAUDE_ENABLE_SUBAGENTS ?? "1").toLowerCase()
  );
  if (!enabled) return "off";

  const normalized = (value ?? "auto").toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "standard") return "standard";
  if (normalized === "aggressive") return "aggressive";
  return aggressiveRequested ? "aggressive" : "standard";
}

function buildClaudeSubagents(mode: Exclude<ClaudeSubagentMode, "off">) {
  const aggressive = mode === "aggressive";
  return {
    researcher: {
      description: aggressive
        ? "Parallel research specialist. Use early for repo exploration, dependency checks, and independent fact-finding while the main agent keeps moving."
        : "Research specialist. Use proactively for background reading, repo exploration, and parallel fact-finding on independent questions.",
      prompt: aggressive
        ? "You are a focused research subagent. Work in parallel on independent questions, keep outputs concise, and return only evidence the main agent can act on immediately."
        : "You are a focused research subagent. Explore only what is needed, summarize findings clearly, and hand back concise evidence the main agent can use immediately.",
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "inherit",
      ...(aggressive ? { background: true, maxTurns: 8 } : {}),
    },
    implementer: {
      description: aggressive
        ? "Implementation specialist. Own isolated code slices in parallel, then hand back a tight summary for final integration."
        : "Implementation specialist. Use proactively for isolated, clearly bounded code changes in specific files or modules.",
      prompt: aggressive
        ? "You are a focused implementation subagent. Make the smallest coherent change for your assigned slice, verify it when practical, and report exactly what changed so the main agent can integrate it fast."
        : "You are a focused implementation subagent. Make the smallest coherent change for the assigned slice, verify it when practical, and report exactly what changed.",
      tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"],
      model: "inherit",
      ...(aggressive ? { maxTurns: 12 } : {}),
    },
    reviewer: {
      description: aggressive
        ? "Parallel review specialist. Audit diffs, tests, and risky assumptions while implementation is still in flight."
        : "Code review specialist. Use proactively after code changes to spot regressions, missing tests, and risky assumptions.",
      prompt: aggressive
        ? "You are a focused reviewer subagent. Review in parallel, prioritize correctness risks and testing gaps, and return concise findings the main agent can act on."
        : "You are a focused reviewer subagent. Review the diff for correctness, regressions, and testing gaps, then return concise, prioritized findings.",
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "inherit",
      ...(aggressive ? { background: true, maxTurns: 8 } : {}),
    },
  } as const;
}

function claudeAutoAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getCoder(opts: RunCoderOptions = {}): Coder {
  const configured = normalizeConfiguredCoder(process.env.CODER);
  return selectCoder(configured, {
    preferClaude: opts.preferClaude,
    claudeAvailable: claudeAutoAvailable(),
  });
}

export async function runCoder(
  prompt: string,
  cwd: string,
  opts: RunCoderOptions = {}
): Promise<Coder> {
  const coder = getCoder(opts);
  if (coder === "codex") await runCodex(prompt, cwd);
  else await runClaude(prompt, cwd, opts);
  return coder;
}

export const CODER_DISPLAY_NAMES: Record<Coder, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

// Coders run headlessly with --dangerously-skip-permissions / --dangerously-bypass-approvals-and-sandbox
// on Linear-issue content (attacker-influenceable if someone can add the `agent` label).
// Restrict their env so a prompt-injected agent cannot read other projects' webhook secrets,
// LINEAR_API_KEY, STATUS_TOKEN, or unrelated host state.
function baseEnv(): NodeJS.ProcessEnv {
  const { PATH, HOME, USER, LANG, LC_ALL, TERM, TZ } = process.env;
  return { PATH, HOME, USER, LANG, LC_ALL, TERM, TZ };
}

async function runClaude(
  prompt: string,
  cwd: string,
  opts: RunCoderOptions
): Promise<void> {
  const env = baseEnv();
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  const args = [
    "--dangerously-skip-permissions",
    "--model", "claude-sonnet-4-5",
    "--max-turns", "30",
  ];
  const subagentMode = resolveClaudeSubagentMode(
    process.env.CLAUDE_SUBAGENT_MODE,
    Boolean(opts.aggressiveDelegation)
  );
  if (subagentMode !== "off") {
    args.push("--agents", JSON.stringify(buildClaudeSubagents(subagentMode)));
  }
  args.push("-p", prompt);
  await exec(
    "claude",
    args,
    { cwd, env, timeoutMs: AGENT_TIMEOUT_MS }
  );
}

async function runCodex(prompt: string, cwd: string): Promise<void> {
  // Empty OPENAI_API_KEY must be unset so Codex falls back to `codex login`
  // credentials (ChatGPT subscription). Setting it to "" defeats the fallback.
  const env = baseEnv();
  if (process.env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  await exec(
    "codex",
    [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      prompt,
    ],
    { cwd, env, timeoutMs: AGENT_TIMEOUT_MS }
  );
}
