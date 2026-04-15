#!/usr/bin/env bash
# One-command installer for a fresh host.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | bash
#   # run as root, or use sudo if needed
#
# Optional env:
#   SOLTO_REPO=mohbreu/solto
#   SOLTO_REF=latest   # or main or a specific tag like v0.1.0
#   AGENT_USER=agent
#   SOLTO_DIR=/home/agent/solto

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo "Run as root or via sudo." >&2
    exit 1
fi

SOLTO_REPO="${SOLTO_REPO:-mohbreu/solto}"
SOLTO_REF_INPUT="${SOLTO_REF:-latest}"
AGENT_USER="${AGENT_USER:-agent}"
SOLTO_DIR="${SOLTO_DIR:-/home/$AGENT_USER/solto}"
BOOTSTRAP_URL="https://raw.githubusercontent.com/${SOLTO_REPO}/main/scripts/bootstrap.sh"
REPO_URL="https://github.com/${SOLTO_REPO}.git"

resolve_latest_release() {
    local repo="$1"
    local release_url="https://api.github.com/repos/${repo}/releases/latest"
    local tag=""

    if command -v curl >/dev/null 2>&1; then
        tag="$(curl -fsSL "$release_url" 2>/dev/null | jq -r '.tag_name // empty' 2>/dev/null || true)"
    fi
    if [ -n "$tag" ] && [ "$tag" != "null" ]; then
        printf '%s\n' "$tag"
        return 0
    fi

    tag="$(git ls-remote --tags --refs "https://github.com/${repo}.git" 'v*' \
        | awk '{print $2}' \
        | sed 's#refs/tags/##' \
        | sort -V \
        | tail -n 1)"
    if [ -n "$tag" ]; then
        printf '%s\n' "$tag"
        return 0
    fi

    echo "Could not resolve latest release tag for ${repo}." >&2
    exit 1
}

resolve_ref() {
    local ref="$1"
    if [ -z "$ref" ] || [ "$ref" = "latest" ]; then
        resolve_latest_release "$SOLTO_REPO"
    else
        printf '%s\n' "$ref"
    fi
}

echo "--- Running bootstrap"
bash -c "$(curl -fsSL "$BOOTSTRAP_URL")"

SOLTO_REF="$(resolve_ref "$SOLTO_REF_INPUT")"

echo "--- Installing solto ref ${SOLTO_REF}"

echo "--- Installing solto repo into ${SOLTO_DIR}"
sudo -u "$AGENT_USER" env \
    SOLTO_DIR="$SOLTO_DIR" \
    REPO_URL="$REPO_URL" \
    SOLTO_REF="$SOLTO_REF" \
    bash <<'AGENT_SETUP'
set -euo pipefail

if [ -d "$SOLTO_DIR/.git" ]; then
    echo "→ updating existing checkout at $SOLTO_DIR"
    git -C "$SOLTO_DIR" fetch --tags origin
    if git -C "$SOLTO_DIR" rev-parse -q --verify "refs/tags/$SOLTO_REF" >/dev/null; then
        git -C "$SOLTO_DIR" checkout --detach "$SOLTO_REF"
    else
        git -C "$SOLTO_DIR" fetch origin "$SOLTO_REF"
        git -C "$SOLTO_DIR" checkout "$SOLTO_REF"
        git -C "$SOLTO_DIR" pull --ff-only origin "$SOLTO_REF"
    fi
else
    echo "→ cloning $REPO_URL into $SOLTO_DIR"
    git clone --branch "$SOLTO_REF" "$REPO_URL" "$SOLTO_DIR"
fi

cd "$SOLTO_DIR"
pnpm install

if [ ! -f .env ]; then
    cp .env.example .env
    echo "→ seeded .env from .env.example"
else
    echo "✓ .env already exists, leaving it alone"
fi

if [ ! -f projects.local.json ]; then
    cp projects.local.json.example projects.local.json
    echo "→ seeded projects.local.json from example"
else
    echo "✓ projects.local.json already exists, leaving it alone"
fi

chmod +x scripts/*.sh install.sh
AGENT_SETUP

cat <<EOF

--- solto install complete

What this installed:
  - host dependencies via scripts/bootstrap.sh
  - repo checkout at ${SOLTO_DIR}
  - node deps via pnpm install
  - starter .env and projects.local.json if they were missing

Next steps (as ${AGENT_USER}):
  sudo su - ${AGENT_USER}
  cd ${SOLTO_DIR}
  gh auth login
  # authenticate your coder:
  #   codex login
  #   or set CODER=claude and ANTHROPIC_API_KEY in .env
  # fill in .env (LINEAR_API_KEY, STATUS_TOKEN, webhook secrets)
  # fill in projects.local.json
  for id in \$(jq -r '.[].id' projects.local.json); do
      ./scripts/add-project.sh "\$id"
  done
  # set up your Cloudflare Tunnel (see ZERO_TO_SOLTO.md)
  ./scripts/doctor.sh
  pm2 start ecosystem.config.cjs
  pm2 save
  # run pm2 startup from your sudo-capable user for boot persistence

Quick install commands for future hosts:
  curl -fsSL https://raw.githubusercontent.com/${SOLTO_REPO}/main/install.sh | bash
  SOLTO_REF=main curl -fsSL https://raw.githubusercontent.com/${SOLTO_REPO}/main/install.sh | bash
  SOLTO_REF=${SOLTO_REF} curl -fsSL https://raw.githubusercontent.com/${SOLTO_REPO}/main/install.sh | bash
  # run those as root, or prefix with sudo if needed
EOF
