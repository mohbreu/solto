const STATUS_LOG_TAIL_LINES = 20;
const STATUS_LOG_TAIL_MIN = 1;
const STATUS_LOG_TAIL_MAX = 50;

export function parseTailLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return STATUS_LOG_TAIL_LINES;
  return Math.min(STATUS_LOG_TAIL_MAX, Math.max(STATUS_LOG_TAIL_MIN, parsed));
}

export function dedupeSequential(lines: string[]): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return deduped;
}

export function isStartupNoise(line: string): boolean {
  const noisePatterns = [
    /^> solto@/,
    /^> tsx --env-file=/,
    /^solto running on :3000$/,
    /^  POST \/webhook\//,
    /^  GET  \/status/,
    /^  GET  \/health$/,
    /^ ?ELIFECYCLE ? Command failed\.$/,
    /^$/,
  ];
  return noisePatterns.some((pattern) => pattern.test(line));
}

export function compactStartupNoise(lines: string[]): string[] {
  const compacted: string[] = [];
  let skippedNoise = 0;

  for (const line of lines) {
    if (!isStartupNoise(line)) {
      if (skippedNoise > 0) {
        compacted.push(`[startup noise omitted: ${skippedNoise} lines]`);
        skippedNoise = 0;
      }
      compacted.push(line);
      continue;
    }
    skippedNoise += 1;
  }

  if (skippedNoise > 0) {
    compacted.push(`[startup noise omitted: ${skippedNoise} lines]`);
  }

  return compacted;
}

export function selectLatestErrorEntries(lines: string[], maxLines: number): string[] {
  const interesting = lines.filter((line) =>
    /\b(ERR|Error|Failed|fatal:|Authentication required|Repository not found)\b/.test(line)
  );
  const source = interesting.length > 0 ? interesting : lines.filter((line) => line.trim().length > 0);
  return source.slice(-maxLines);
}
