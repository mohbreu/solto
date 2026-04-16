#!/usr/bin/env bash
# Upgrade the local solto checkout in a safe, repeatable way.
#
# Usage:
#   ./scripts/upgrade.sh
#   ./scripts/upgrade.sh latest
#   ./scripts/upgrade.sh main
#   ./scripts/upgrade.sh v0.1.0
#
# Expected environment:
#   Run this from the solto checkout on the host, as the agent user.
#   The script refuses to proceed if the working tree is dirty.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_INPUT="${1:-latest}"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

require_cmd git
require_cmd pnpm
require_cmd pm2

resolve_latest_release() {
    local release_url
    local repo_url
    local repo_path
    local tag=""

    repo_url="$(git -C "$ROOT" remote get-url origin)"
    repo_path="${repo_url#https://github.com/}"
    repo_path="${repo_path#git@github.com:}"
    repo_path="${repo_path%.git}"
    release_url="https://api.github.com/repos/${repo_path}/releases/latest"

    if command -v curl >/dev/null 2>&1; then
        tag="$(curl -fsSL "$release_url" 2>/dev/null | jq -r '.tag_name // empty' 2>/dev/null || true)"
    fi
    if [ -n "$tag" ] && [ "$tag" != "null" ]; then
        printf '%s\n' "$tag"
        return 0
    fi

    tag="$(git -C "$ROOT" ls-remote --tags --refs origin 'v*' \
        | awk '{print $2}' \
        | sed 's#refs/tags/##' \
        | sort -V \
        | tail -n 1)"
    if [ -n "$tag" ]; then
        printf '%s\n' "$tag"
        return 0
    fi

    echo "Could not resolve latest release tag from origin." >&2
    exit 1
}

resolve_target_ref() {
    local ref="$1"
    if [ -z "$ref" ] || [ "$ref" = "latest" ]; then
        resolve_latest_release
    else
        printf '%s\n' "$ref"
    fi
}

detect_tunnel_hostname() {
    local config_path="$HOME/.cloudflared/config.yml"
    if [ -f "$config_path" ]; then
        sed -nE 's/^[[:space:]-]*hostname:[[:space:]]*([^[:space:]]+)[[:space:]]*$/\1/p' "$config_path" | head -n1
    fi
}

if [ ! -d "$ROOT/.git" ]; then
    echo "This script must be run from a solto checkout." >&2
    exit 1
fi

cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is dirty. Commit or stash changes before upgrading." >&2
    exit 1
fi

TARGET_REF="$(resolve_target_ref "$TARGET_INPUT")"
TUNNEL_HOSTNAME="$(detect_tunnel_hostname)"
if [ -n "$TUNNEL_HOSTNAME" ]; then
    TUNNEL_SETUP_CMD="./scripts/setup-tunnel.sh ${TUNNEL_HOSTNAME}"
    TUNNEL_HEALTH_CMD="curl https://${TUNNEL_HOSTNAME}/health"
else
    TUNNEL_SETUP_CMD="./scripts/setup-tunnel.sh <your-host>.<your-domain>"
    TUNNEL_HEALTH_CMD="curl https://<your-host>.<your-domain>/health"
fi

echo "--- Fetching ${TARGET_REF}"
git fetch --force --tags origin

if git rev-parse -q --verify "refs/tags/$TARGET_REF" >/dev/null; then
    git checkout --detach "$TARGET_REF"
else
    git fetch origin "$TARGET_REF"
    git checkout "$TARGET_REF"
    git pull --ff-only origin "$TARGET_REF"
fi

echo "--- Refreshing dependencies"
pnpm install --frozen-lockfile

echo "--- Refreshing pm2 processes with current env"
pm2 delete solto >/dev/null 2>&1 || true
pm2 delete cloudflare-tunnel >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

cat <<EOF

--- Upgrade complete

The local checkout is now on ${TARGET_REF}, dependencies are refreshed,
and pm2 has been restarted with the current environment.

Recommended next steps:
  ./scripts/doctor.sh

If you changed auth, .env, or project config as part of the upgrade:
  pm2 restart solto --update-env
  pm2 restart cloudflare-tunnel

If doctor reports missing Cloudflare tunnel setup:
  ${TUNNEL_SETUP_CMD}
  pm2 restart cloudflare-tunnel
  ${TUNNEL_HEALTH_CMD}
EOF
