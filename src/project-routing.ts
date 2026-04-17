export function issueBelongsToProject(
  project: { linearProjectId: string },
  issueProjectId: string | null | undefined
): boolean {
  return Boolean(issueProjectId) && issueProjectId === project.linearProjectId;
}

export function findProjectByLinearProjectId<T extends { linearProjectId: string }>(
  projects: Iterable<T>,
  issueProjectId: string | null | undefined
): T | null {
  if (!issueProjectId) return null;
  for (const project of projects) {
    if (project.linearProjectId === issueProjectId) {
      return project;
    }
  }
  return null;
}
