import crypto from "node:crypto";
import { parsePullRequestNumber } from "./reconcile-utils.js";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  teamId: string;
  stateName: string | null;
  assigneeId: string | null;
}

export interface LinearComment {
  id: string;
  body: string;
  issueId: string;
}

export interface LinearViewer {
  id: string;
  name: string;
}

export const STATE_IN_PROGRESS = "In Progress";
export const STATE_IN_REVIEW = "In Review";
export const STATE_TODO = "Todo";
export const STATE_DONE = "Done";

export interface LinearPullRequestAttachmentInput {
  title: string;
  subtitle: string;
  url: string;
}

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

export function buildPullRequestAttachmentInput(
  prUrl: string,
  status: "open" | "merged" = "open"
): LinearPullRequestAttachmentInput {
  const prNumber = parsePullRequestNumber(prUrl);
  const title = prNumber
    ? `Pull Request #${prNumber}`
    : "Pull Request";

  return {
    title,
    subtitle: status === "merged" ? "Merged" : "Open",
    url: prUrl,
  };
}

export async function syncPullRequestAttachment(
  issueId: string,
  prUrl: string,
  status: "open" | "merged" = "open"
): Promise<void> {
  const attachment = buildPullRequestAttachmentInput(prUrl, status);
  await linearGraphQL(
    `mutation AttachmentCreate(
      $issueId: String!,
      $title: String!,
      $subtitle: String!,
      $url: String!
    ) {
      attachmentCreate(input: {
        issueId: $issueId,
        title: $title,
        subtitle: $subtitle,
        url: $url
      }) { success }
    }`,
    {
      issueId,
      title: attachment.title,
      subtitle: attachment.subtitle,
      url: attachment.url,
    }
  );
}

export async function getIssueById(
  issueId: string
): Promise<LinearIssue | null> {
  const data = await linearGraphQL<{
    issue:
      | {
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          team: { id: string };
          state: { name: string } | null;
          assignee: { id: string } | null;
        }
      | null;
  }>(
    `query IssueDetails($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        team { id }
        state { name }
        assignee { id }
      }
    }`,
    { id: issueId }
  );
  if (!data.issue) return null;
  return {
    id: data.issue.id,
    identifier: data.issue.identifier,
    title: data.issue.title,
    description: data.issue.description ?? "",
    teamId: data.issue.team.id,
    stateName: data.issue.state?.name ?? null,
    assigneeId: data.issue.assignee?.id ?? null,
  };
}

let viewerPromise: Promise<LinearViewer | null> | null = null;

export async function getViewer(): Promise<LinearViewer | null> {
  if (!viewerPromise) {
    viewerPromise = linearGraphQL<{
      viewer: { id: string; name: string } | null;
    }>(
      `query Viewer {
        viewer { id name }
      }`,
      {}
    )
      .then((data) => {
        if (!data.viewer) return null;
        return {
          id: data.viewer.id,
          name: data.viewer.name,
        };
      })
      .catch((err) => {
        viewerPromise = null;
        throw err;
      });
  }

  return await viewerPromise;
}

export async function getViewerId(): Promise<string | null> {
  return (await getViewer())?.id ?? null;
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
