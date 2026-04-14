import crypto from "node:crypto";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  teamId: string;
}

export const STATE_IN_PROGRESS = "In Progress";
export const STATE_IN_REVIEW = "In Review";
export const STATE_TODO = "Todo";
export const STATE_DONE = "Done";

export function verifyLinearWebhook(
  signature: string | null,
  rawBody: string,
  secret: string
): boolean {
  // Linear signs with HMAC-SHA256 and sends hex. Fixed length + charset
  // guards timingSafeEqual against throws and keeps the compare constant-time.
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest();
  const provided = Buffer.from(signature, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

async function linearGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.LINEAR_API_KEY!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data!;
}

export async function postLinearComment(
  issueId: string,
  body: string
): Promise<void> {
  await linearGraphQL(
    `mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body }
  );
}

export async function getIssueStateName(
  issueId: string
): Promise<string | null> {
  const data = await linearGraphQL<{
    issue: { state: { name: string } | null } | null;
  }>(
    `query IssueState($id: String!) {
      issue(id: $id) { state { name } }
    }`,
    { id: issueId }
  );
  return data.issue?.state?.name ?? null;
}

const stateCache = new Map<string, Map<string, string>>();

async function getStateId(
  teamId: string,
  name: string
): Promise<string | null> {
  let teamStates = stateCache.get(teamId);
  if (!teamStates) {
    const data = await linearGraphQL<{
      team: { states: { nodes: { id: string; name: string }[] } };
    }>(
      `query Team($id: String!) {
        team(id: $id) { states { nodes { id name } } }
      }`,
      { id: teamId }
    );
    teamStates = new Map(data.team.states.nodes.map((s) => [s.name, s.id]));
    stateCache.set(teamId, teamStates);
  }
  return teamStates.get(name) ?? null;
}

export async function setIssueState(
  issueId: string,
  teamId: string,
  stateName: string
): Promise<void> {
  try {
    const stateId = await getStateId(teamId, stateName);
    if (!stateId) {
      console.warn(`[linear] State "${stateName}" not found for team ${teamId}`);
      return;
    }
    await linearGraphQL(
      `mutation IssueUpdate($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      { id: issueId, stateId }
    );
  } catch (err) {
    console.error(`[linear] Failed to set state "${stateName}":`, err);
  }
}
