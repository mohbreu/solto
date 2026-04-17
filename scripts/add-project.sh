#!/usr/bin/env bash
# Bootstrap a single project's on-disk state based on projects.local.json.
# Idempotent: safe to re-run.
#
# Usage: ./scripts/add-project.sh <project-id>

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/projects.local.json"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <project-id>" >&2
    exit 2
fi

id="$1"

if [[ ! "$id" =~ ^[a-z0-9-]+$ ]]; then
    echo "Invalid project id '$id': must match ^[a-z0-9-]+$" >&2
    exit 2
fi

if [ ! -f "$CONFIG" ]; then
    echo "Missing $CONFIG. Copy projects.local.json.example and edit it." >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "This script needs 'jq'. Install it with: sudo apt-get install -y jq" >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "This script needs 'curl'. Install it with: sudo apt-get install -y curl" >&2
    exit 1
fi

github_repo=$(jq -r --arg id "$id" '.[] | select(.id == $id) | .githubRepo' "$CONFIG")
if [ -z "$github_repo" ] || [ "$github_repo" = "null" ]; then
    echo "Project '$id' not found in $CONFIG" >&2
    exit 1
fi

linear_project_id=$(jq -r --arg id "$id" '.[] | select(.id == $id) | .linearProjectId // empty' "$CONFIG")
linear_project_name=$(jq -r --arg id "$id" '.[] | select(.id == $id) | .linearProjectName // empty' "$CONFIG")

repo_dir="$ROOT/repos/$id"
worker_dir="$ROOT/workers/$id"
env_file="$ROOT/.env"
repo_env_file="$repo_dir/.env"

if [ -z "$linear_project_id" ]; then
    if [ -z "$linear_project_name" ]; then
        echo "Project '$id' is missing both linearProjectId and linearProjectName in $CONFIG" >&2
        exit 1
    fi

    if [ ! -f "$env_file" ]; then
        echo "Missing $env_file; cannot resolve linearProjectName without LINEAR_API_KEY" >&2
        exit 1
    fi

    linear_api_key="$(sed -nE 's/^[[:space:]]*LINEAR_API_KEY[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p' "$env_file" | head -n1)"
    if [[ "$linear_api_key" =~ ^\"(.*)\"$ ]]; then
        linear_api_key="${BASH_REMATCH[1]}"
    elif [[ "$linear_api_key" =~ ^\'(.*)\'$ ]]; then
        linear_api_key="${BASH_REMATCH[1]}"
    fi
    if [ -z "$linear_api_key" ]; then
        echo "LINEAR_API_KEY missing in $env_file; cannot resolve linearProjectName" >&2
        exit 1
    fi

    linear_query='query($name: String!) { projects(first: 100, includeArchived: true, filter: { name: { eq: $name } }) { nodes { id name } } }'
    linear_response="$(
        curl -fsSL https://api.linear.app/graphql \
            -H "content-type: application/json" \
            -H "authorization: $linear_api_key" \
            --data "$(jq -cn --arg query "$linear_query" --arg name "$linear_project_name" '{query: $query, variables: {name: $name}}')"
    )"

    linear_match_count="$(jq '[.data.projects.nodes[]?] | length' <<<"$linear_response")"
    if [ "$linear_match_count" -eq 0 ]; then
        echo "Could not resolve linearProjectName '$linear_project_name' in Linear" >&2
        exit 1
    fi
    if [ "$linear_match_count" -gt 1 ]; then
        echo "linearProjectName '$linear_project_name' matched multiple Linear projects; use linearProjectId instead" >&2
        exit 1
    fi

    linear_project_id="$(jq -r '.data.projects.nodes[0].id' <<<"$linear_response")"
    tmp_config="$(mktemp)"
    jq --arg id "$id" --arg linear_project_id "$linear_project_id" '
        map(
            if .id == $id
            then . + { linearProjectId: $linear_project_id }
            else .
            end
        )
    ' "$CONFIG" > "$tmp_config"
    mv "$tmp_config" "$CONFIG"
    echo "→ resolved Linear project '$linear_project_name' to $linear_project_id and saved it in projects.local.json"
fi

if [ -d "$repo_dir/.git" ]; then
    echo "✓ $repo_dir already exists, skipping clone"
else
    echo "→ cloning $github_repo into $repo_dir"
    mkdir -p "$ROOT/repos"
    gh repo clone "$github_repo" "$repo_dir"
fi

mkdir -p "$worker_dir"
echo "✓ $worker_dir ready"

if [ ! -f "$env_file" ]; then
    if [ -f "$ROOT/.env.example" ]; then
        cp "$ROOT/.env.example" "$env_file"
        echo "→ seeded .env from .env.example"
    else
        touch "$env_file"
    fi
fi

if grep -q "^LINEAR_WEBHOOK_SECRET=" "$env_file"; then
    echo "✓ LINEAR_WEBHOOK_SECRET already set in root .env"
else
    echo "LINEAR_WEBHOOK_SECRET=" >> "$env_file"
    echo "→ appended LINEAR_WEBHOOK_SECRET= to root .env (fill in if this host shares one Linear board secret)"
fi

cat <<EOF

Next steps for '$id':
  1. In Linear, create a webhook at Settings → API → Webhooks:
       URL: https://<your-webhook-host>/linear-webhook
       Resource types: Issues + Comments
     If multiple projects live under the same Linear team, they can share that one team-level webhook.
     If projects live under different Linear teams, create one webhook per team, all pointing to /linear-webhook.
     Copy the signing secret.
  2. If every project on this host shares one Linear board secret, paste it into root .env as:
       LINEAR_WEBHOOK_SECRET=<secret>
     Otherwise add a repo-local override in:
       ${repo_env_file}
     with:
       LINEAR_WEBHOOK_SECRET=<secret>
  3. Assign work to your bot user when the issue is in Todo / To do.
     Optional: add the 'yolo' label to push directly to the base branch.
  4. pm2 restart solto
EOF
