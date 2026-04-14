import { exec } from "./exec.js";

export type Coder = "claude" | "codex";

const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 20 * 60 * 1000);

export function getCoder(): Coder {
  const v = (process.env.CODER ?? "codex").toLowerCase();
  if (v !== "claude" && v !== "codex") {
    throw new Error(`Unknown CODER: ${v} (expected "claude" or "codex")`);
  }
  return v;
}

export async function runCoder(
  prompt: string,
  cwd: string
): Promise<Coder> {
  const coder = getCoder();
  if (coder === "codex") await runCodex(prompt, cwd);
  else await runClaude(prompt, cwd);
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

async function runClaude(prompt: string, cwd: string): Promise<void> {
  const env = baseEnv();
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  await exec(
    "claude",
    [
      "--dangerously-skip-permissions",
      "--model", "claude-sonnet-4-5",
      "--max-turns", "30",
      "-p", prompt,
    ],
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
