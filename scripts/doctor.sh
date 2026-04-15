#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

PM2_JSON_FILE=""
LINEAR_TMP=""
GH_AUTH_TMP=""

declare -A ENV_VARS

cleanup() {
    [ -n "$PM2_JSON_FILE" ] && rm -f "$PM2_JSON_FILE"
    [ -n "$LINEAR_TMP" ] && rm -f "$LINEAR_TMP"
    [ -n "$GH_AUTH_TMP" ] && rm -f "$GH_AUTH_TMP"
}
trap cleanup EXIT

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '[PASS] %s\n' "$1"
}

warn() {
    WARN_COUNT=$((WARN_COUNT + 1))
    printf '[WARN] %s\n' "$1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf '[FAIL] %s\n' "$1"
}

section() {
    printf '\n== %s ==\n' "$1"
}

load_env_file() {
    local env_file="$ROOT/.env"
    if [ ! -f "$env_file" ]; then
        fail "Missing $env_file"
        return
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        if [[ "$line" =~ ^[[:space:]]*([A-Z0-9_]+)[[:space:]]*=(.*)$ ]]; then
            ENV_VARS["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        fi
    done < "$env_file"

    pass ".env present"
}

env_get() {
    local key="$1"
    printf '%s' "${ENV_VARS[$key]-}"
}

env_has() {
    local key="$1"
    [ -n "${ENV_VARS[$key]-}" ]
}

check_command() {
    local cmd="$1"
    if command -v "$cmd" >/dev/null 2>&1; then
        pass "Command available: $cmd"
    else
        fail "Missing command: $cmd"
    fi
}

check_file() {
    local path="$1"
    local label="$2"
    if [ -f "$path" ]; then
        pass "$label present"
    else
        fail "$label missing: $path"
    fi
}

check_dir() {
    local path="$1"
    local label="$2"
    if [ -d "$path" ]; then
        pass "$label present"
    else
        fail "$label missing: $path"
    fi
}

pm2_env_value() {
    local key="$1"
    jq -r --arg key "$key" '
        [.[] | select(.name == "solto")][0].pm2_env.env[$key] // ""
    ' "$PM2_JSON_FILE"
}

compare_pm2_env() {
    local key="$1"
    local expected actual
    expected="$(env_get "$key")"
    actual="$(pm2_env_value "$key")"

    if [ -z "$expected" ] && [ -z "$actual" ]; then
        return
    fi

    if [ "$expected" = "$actual" ]; then
        pass "pm2 env matches .env for $key"
    else
        fail "pm2 env mismatch for $key; recreate or restart solto with fresh env"
    fi
}

section "Core files"
check_file "$ROOT/package.json" "package.json"
check_file "$ROOT/ecosystem.config.cjs" "ecosystem config"
check_file "$ROOT/projects.local.json" "projects.local.json"
load_env_file

section "Commands"
for cmd in bash git gh jq curl node pnpm pm2 cloudflared; do
    check_command "$cmd"
done

CODER="$(env_get CODER)"
if [ -z "$CODER" ]; then
    CODER="codex"
    warn "CODER not set in .env; solto defaults to codex"
fi

case "$CODER" in
    codex)
        check_command codex
        if env_has OPENAI_API_KEY; then
            pass "OPENAI_API_KEY configured for Codex"
        elif [ -d "$HOME/.codex" ]; then
            pass "Codex login state present under ~/.codex"
        else
            fail "Codex selected but neither OPENAI_API_KEY nor ~/.codex login state is present"
        fi
        ;;
    claude)
        check_command claude
        if env_has ANTHROPIC_API_KEY; then
            pass "ANTHROPIC_API_KEY configured for Claude"
        else
            warn "Claude selected without ANTHROPIC_API_KEY; doctor cannot verify interactive Claude login automatically"
        fi
        if env_has CLAUDE_ENABLE_SUBAGENTS; then
            pass "CLAUDE_ENABLE_SUBAGENTS explicitly set"
        else
            pass "CLAUDE_ENABLE_SUBAGENTS not set; Claude subagents default to enabled"
        fi
        ;;
    *)
        fail "Unknown CODER value: $CODER"
        ;;
esac

section "Environment"
if env_has LINEAR_API_KEY; then
    pass "LINEAR_API_KEY configured"
else
    fail "LINEAR_API_KEY missing"
fi

if env_has GITHUB_WEBHOOK_SECRET; then
    pass "GITHUB_WEBHOOK_SECRET configured"
else
    fail "GITHUB_WEBHOOK_SECRET missing"
fi

if env_has STATUS_TOKEN; then
    pass "STATUS_TOKEN configured"
else
    fail "STATUS_TOKEN missing"
fi

if env_has LINEAR_BOT_MENTION; then
    pass "LINEAR_BOT_MENTION configured"
else
    warn "LINEAR_BOT_MENTION not set; solto will derive mention aliases from the Linear bot user name"
fi

section "Project config"
if jq -e 'type == "array"' "$ROOT/projects.local.json" >/dev/null 2>&1; then
    pass "projects.local.json is a JSON array"
else
    fail "projects.local.json must be a JSON array"
fi

mapfile -t PROJECT_IDS < <(jq -r '.[].id' "$ROOT/projects.local.json")
if [ "${#PROJECT_IDS[@]}" -eq 0 ]; then
    fail "projects.local.json has no projects"
fi

for project_id in "${PROJECT_IDS[@]}"; do
    env_key="$(printf '%s' "$project_id" | tr 'a-z-' 'A-Z_')_LINEAR_SECRET"
    repo_dir="$ROOT/repos/$project_id"
    workers_dir="$ROOT/workers/$project_id"
    github_repo="$(jq -r --arg id "$project_id" '.[] | select(.id == $id) | .githubRepo' "$ROOT/projects.local.json")"

    if env_has "$env_key"; then
        pass "$project_id webhook secret configured"
    else
        fail "$project_id missing .env secret: $env_key"
    fi

    check_dir "$repo_dir" "$project_id repo dir"
    check_dir "$workers_dir" "$project_id workers dir"

    if [ -d "$repo_dir/.git" ]; then
        pass "$project_id git clone present"
    else
        fail "$project_id repo missing .git directory"
        continue
    fi

    if [ -f "$repo_dir/AGENTS.md" ]; then
        pass "$project_id AGENTS.md present"
    else
        fail "$project_id missing AGENTS.md at repo root"
    fi

    origin_url="$(git -C "$repo_dir" config --get remote.origin.url || true)"
    if [[ "$origin_url" == *"$github_repo"* ]]; then
        pass "$project_id origin matches $github_repo"
    else
        warn "$project_id origin does not obviously match $github_repo"
    fi

    if git -C "$repo_dir" ls-remote origin -q HEAD >/dev/null 2>&1; then
        pass "$project_id remote access works"
    else
        fail "$project_id cannot reach origin; check gh auth and repo access"
    fi
done

section "GitHub auth"
GH_AUTH_TMP="$(mktemp)"
if gh auth status > "$GH_AUTH_TMP" 2>&1; then
    active_account="$(
        awk '
            /Logged in to github.com account / {
                account = $7
            }
            /Active account: true/ {
                print account
                exit
            }
        ' "$GH_AUTH_TMP"
    )"
    if [ -n "$active_account" ]; then
        pass "gh auth ok (active account: $active_account)"
    else
        pass "gh auth ok"
    fi
else
    fail "gh auth status failed"
fi

section "Linear API"
if env_has LINEAR_API_KEY; then
    LINEAR_TMP="$(mktemp)"
    if curl -fsS --max-time 10 \
        -H "Content-Type: application/json" \
        -H "Authorization: $(env_get LINEAR_API_KEY)" \
        --data '{"query":"query { viewer { id name } }"}' \
        https://api.linear.app/graphql > "$LINEAR_TMP" 2>/dev/null; then
        viewer_name="$(jq -r '.data.viewer.name // empty' "$LINEAR_TMP" 2>/dev/null || true)"
        viewer_id="$(jq -r '.data.viewer.id // empty' "$LINEAR_TMP" 2>/dev/null || true)"
        if [ -n "$viewer_id" ]; then
            pass "Linear API token works (viewer: ${viewer_name:-unknown})"
        else
            fail "Linear API token did not return viewer identity"
        fi
    else
        fail "Linear API request failed"
    fi
fi

section "pm2"
PM2_JSON_FILE="$(mktemp)"
if pm2 jlist > "$PM2_JSON_FILE" 2>/dev/null; then
    if jq -e '.[] | select(.name == "solto")' "$PM2_JSON_FILE" >/dev/null; then
        pass "pm2 has a solto process"
        solto_status="$(jq -r '[.[] | select(.name == "solto")][0].pm2_env.status // ""' "$PM2_JSON_FILE")"
        if [ "$solto_status" = "online" ]; then
            pass "solto is online in pm2"
        else
            fail "solto pm2 status is $solto_status"
        fi
        solto_cwd="$(jq -r '[.[] | select(.name == "solto")][0].pm2_env.pm_cwd // ""' "$PM2_JSON_FILE")"
        if [ "$solto_cwd" = "$ROOT" ]; then
            pass "solto pm2 cwd matches $ROOT"
        else
            fail "solto pm2 cwd is $solto_cwd, expected $ROOT"
        fi
        for key in CODER LINEAR_API_KEY GITHUB_WEBHOOK_SECRET OPENAI_API_KEY ANTHROPIC_API_KEY STATUS_TOKEN LINEAR_BOT_MENTION TUNNEL_NAME; do
            compare_pm2_env "$key"
        done
        for project_id in "${PROJECT_IDS[@]}"; do
            compare_pm2_env "$(printf '%s' "$project_id" | tr 'a-z-' 'A-Z_')_LINEAR_SECRET"
        done
    else
        fail "pm2 does not have a solto process"
    fi

    if jq -e '.[] | select(.name == "cloudflare-tunnel")' "$PM2_JSON_FILE" >/dev/null; then
        pass "pm2 has a cloudflare-tunnel process"
        tunnel_status="$(jq -r '[.[] | select(.name == "cloudflare-tunnel")][0].pm2_env.status // ""' "$PM2_JSON_FILE")"
        if [ "$tunnel_status" = "online" ]; then
            pass "cloudflare-tunnel is online in pm2"
        else
            warn "cloudflare-tunnel pm2 status is $tunnel_status"
        fi
    else
        warn "pm2 does not have a cloudflare-tunnel process"
    fi
else
    fail "pm2 jlist failed"
fi

section "Local HTTP checks"
if curl -fsS --max-time 5 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    pass "Local /health responds"
else
    fail "Local /health failed"
fi

if env_has STATUS_TOKEN; then
    if curl -fsS --max-time 5 \
        -H "x-status-token: $(env_get STATUS_TOKEN)" \
        http://127.0.0.1:3000/status >/dev/null 2>&1; then
        pass "Local /status responds with STATUS_TOKEN"
    else
        fail "Local /status failed with STATUS_TOKEN"
    fi
fi

printf '\nSummary: %d pass, %d warn, %d fail\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
