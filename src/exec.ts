import { spawn } from "node:child_process";

interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function exec(
  cmd: string,
  args: string[],
  options: ExecOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTree = () => {
      if (proc.pid === undefined) return;
      try { process.kill(-proc.pid, "SIGKILL"); }
      catch { try { proc.kill("SIGKILL"); } catch {} }
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree();
        }, options.timeoutMs)
      : undefined;

    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        return reject(
          new Error(`Timed out after ${options.timeoutMs}ms: ${cmd}`)
        );
      }
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Exited with code ${code}`));
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

export async function execSilent(
  cmd: string,
  args: string[],
  options: ExecOptions = {}
): Promise<void> {
  await exec(cmd, args, options).catch(() => {});
}
