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

github_repo=$(jq -r --arg id "$id" '.[] | select(.id == $id) | .githubRepo' "$CONFIG")
if [ -z "$github_repo" ] || [ "$github_repo" = "null" ]; then
    echo "Project '$id' not found in $CONFIG" >&2
    exit 1
fi

repo_dir="$ROOT/repos/$id"
worker_dir="$ROOT/workers/$id"
env_file="$ROOT/.env"
repo_env_file="$repo_dir/.env"

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
       URL: https://<your-webhook-host>/webhook/$id
       Resource types: Issues + Comments
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
