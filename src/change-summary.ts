function summarizeAreas(files: string[]): string[] {
  const ranked = new Map<string, number>();

  for (const file of files) {
    const normalized = file.trim().replace(/^\.?\//, "");
    if (!normalized) continue;

    const parts = normalized.split("/");
    const area = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    ranked.set(area, (ranked.get(area) ?? 0) + 1);
  }

  return [...ranked.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([area]) => area);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

export function buildChangeSummary(
  files: string[],
  additions: number,
  deletions: number
): string {
  const cleanedFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
  if (cleanedFiles.length === 0) return "Updated the codebase, but the exact changed files could not be summarized.";

  const areas = summarizeAreas(cleanedFiles);
  const firstParagraph = [
    `Updated ${pluralize(cleanedFiles.length, "file")}`,
    `with about +${additions} / -${deletions} lines changed.`,
  ].join(" ");

  const notes: string[] = [];
  if (areas.length) {
    notes.push(`Main touched areas were ${joinNatural(areas)}.`);
  }
  if (cleanedFiles.some((file) => /(^|\/)(test|tests)\//.test(file) || /\.test\./.test(file))) {
    notes.push("The diff also includes test changes.");
  }
  if (cleanedFiles.some((file) => /(^|\/)(docs|doc)\//.test(file) || /\.md$/i.test(file))) {
    notes.push("Documentation was updated alongside the implementation.");
  }
  if (cleanedFiles.some((file) => /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file))) {
    notes.push("Dependency or package metadata changed as part of the update.");
  }
  if (cleanedFiles.some((file) => /(^|\/)(assets|public|images|img)\//.test(file))) {
    notes.push("Asset files were updated too.");
  }

  const secondParagraph = notes.join(" ");
  return secondParagraph ? `${firstParagraph}\n\n${secondParagraph}` : firstParagraph;
}
