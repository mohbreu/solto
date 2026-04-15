# Zero to Solto

Reference for installing and operating solto on your own Linux host. Paths assume Ubuntu 24.04 on the `agent` user, but anything Linux + [systemd](https://systemd.io/) / [pm2](https://pm2.keymetrics.io/) should work.

> **Before installing, read [README.md § Trust model](./README.md#-trust-model-read-before-deploying).** solto runs a coding agent with permissions bypassed on attacker-influenceable input. Anyone who can assign an issue to the bot user has what is effectively shell access to your host.

## Installing on a New Machine

### 1. Fast Path: One Command on a Fresh Ubuntu Host

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | bash
```

By default this resolves the latest GitHub release tag. You can override it:

```bash
SOLTO_REF=main curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | bash
SOLTO_REF=v0.1.0 curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | bash
```

Run those as root, or prefix them with `sudo` if needed.

This does four things:

- Runs `scripts/bootstrap.sh`.
- Clones or Updates `~/solto`.
- Runs `pnpm install`.
- Seeds `.env` and `projects.local.json` From the Examples if They Are Missing.

It intentionally does not try to automate the interactive or environment-specific steps:

- `gh auth login`.
- `codex login` or Claude Auth / API Key Setup.
- Editing `.env`.
- Editing `projects.local.json`.
- Cloudflare Tunnel Login and DNS Setup.
- Linear Webhook Creation.
- GitHub Webhook Creation.

After the installer finishes, continue with:

1. [Authenticate the coder](#4-authenticate-the-coder)
2. [Set up public HTTPS](#5-set-up-public-https-cloudflare-tunnel)
3. [Create webhooks](#6-create-webhooks)
4. [Start solto](#7-start-solto)

### 2. Manual Path: Bootstrap Only

If you want to provision the host without cloning/configuring the repo yet, use the bootstrap-only flow:

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/scripts/bootstrap.sh | sudo bash
```

This creates the `agent` user (no sudo, intentionally) and installs `git`, `gh`, `jq`, Node LTS, pnpm, pm2, `cloudflared` and both the [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) and [Codex](https://github.com/openai/codex) CLIs. On anything not Ubuntu, read the script and port it by hand.

### 3. Clone and Configure Solto (as the `agent` User)

```bash
sudo su - agent
gh auth login                                       # authenticate GitHub
git clone https://github.com/mohbreu/solto.git ~/solto
cd ~/solto
pnpm install

cp .env.example .env                                # fill in API keys, LINEAR_API_KEY, STATUS_TOKEN
cp projects.local.json.example projects.local.json  # list your projects

# Scaffold per-project state (clones repos, creates workers dirs, appends .env keys)
for id in $(jq -r '.[].id' projects.local.json); do
    ./scripts/add-project.sh "$id"
done
```

## Host Dependencies: Manual Reference

`scripts/bootstrap.sh` installs all of these on a fresh Ubuntu box. If you're installing by hand, here's the full list.

solto assumes [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for public HTTPS. It's free, needs no firewall changes, gives you automatic HTTPS and works wherever your domain is on [Cloudflare DNS](https://www.cloudflare.com/). If you'd rather use something else ([nginx](https://nginx.org/) + [Let's Encrypt](https://letsencrypt.org/), [Caddy](https://caddyserver.com/) or [ngrok](https://ngrok.com/)), swap it in. solto only cares that something forwards HTTPS to `localhost:3000`.

### System packages (apt)

| Package | Purpose |
|---|---|
| [`git`](https://git-scm.com/) | solto clones target repos, creates worktrees, commits, pushes |
| `curl`, `ca-certificates` | Fetching installers / TLS |
| [`gh`](https://cli.github.com/) | Used inside agent runs for `gh pr create` and by `add-project.sh` for `gh repo clone`. **Must be authenticated** (`gh auth login`) as the `agent` user with push + PR-create permission on every target repo |
| [`jq`](https://jqlang.org/) | `add-project.sh` parses `projects.local.json` |

### Per-user (installed under `~agent`)

| Tool | Why |
|---|---|
| [**mise**](https://mise.jdx.dev/) | Version manager that pins Node LTS and owns the pnpm/pm2 installs |
| [**Node LTS**](https://nodejs.org/) | solto is Node + [Hono](https://hono.dev/) |
| [**pnpm**](https://pnpm.io/) | Package manager (the repo's `packageManager` field pins it) |
| [**pm2**](https://pm2.keymetrics.io/) | Process supervisor for `solto` and `cloudflare-tunnel` |
| [**Claude Code CLI**](https://docs.claude.com/en/docs/claude-code/overview) (`~/.local/bin/claude`) | Headless agent runtime when `CODER=claude` |
| [**Codex CLI**](https://github.com/openai/codex) (global npm) | Headless agent runtime when `CODER=codex` (default) |
| [**cloudflared**](https://github.com/cloudflare/cloudflared) (`~/.local/bin/cloudflared`) | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for public HTTPS |

### External Accounts / Credentials

| Account | Used for |
|---|---|
| [GitHub](https://github.com/) (for the `agent` user) | `gh auth login`, with push + PR-create on target repos |
| [Linear](https://linear.app/) workspace | Personal API key (`LINEAR_API_KEY`) + one webhook per project with its signing secret |
| [GitHub](https://github.com/) target repos | One `pull_request` webhook per repo using `GITHUB_WEBHOOK_SECRET` so merged PRs can move issues to Done |
| [Anthropic API](https://console.anthropic.com/) key *or* [Claude subscription](https://www.anthropic.com/pricing#claude-code) | If `CODER=claude` |
| [OpenAI API](https://platform.openai.com/) key *or* [ChatGPT subscription](https://openai.com/chatgpt/pricing/) (`codex login`) | If `CODER=codex` (default) |
| A [Cloudflare](https://www.cloudflare.com/)-managed domain | For the Cloudflare Tunnel hostname |

Best practice: use a dedicated Linear user such as `solto-bot` for `LINEAR_API_KEY` so automation comments and state changes are isolated from your personal account.

For multiple repos or teams, keep one project entry per repo/team pair. The shared host settings stay the same, but each project gets its own Linear webhook secret, GitHub repo webhook, clone and worktree directory.

## Target Project Requirements

For solto to open PRs against a GitHub repo, the repo must meet these conditions:

1. **GitHub-hosted**. solto clones via `gh repo clone <owner>/<repo>` and opens PRs via `gh pr create`.
2. **`agent` user has push + PR-create permission**. Configure this once via `gh auth login`. For org-owned repos, make sure the auth token has the right scopes and the user is a collaborator with at least Write access.
3. **A default branch exists**. `main` by default. If yours is different, set `githubBase` for that entry in `projects.local.json`.
4. **`AGENTS.md` at the repo root**. Both Claude Code and Codex read this natively. solto's agent prompt explicitly instructs the agent to read it first and follow every rule. Without one, the agent will guess at your conventions.

### What to Put in `AGENTS.md`

Minimum contents for the agent to do good work:

- **Commit Conventions**.
- **PR Conventions**.
- **Code Style**.
- **Test Policy**.
- **Dependency Policy**.
- **Build/Dev Setup**.
- **Files/Directories the Agent Should Never Touch**.

## 4. Authenticate the Coder

**Codex (default)**: two options:
- ChatGPT Subscription: Run `codex login` Once (Browser Flow). Credentials Land in `~/.codex/`. Leave `OPENAI_API_KEY` Empty in `.env`.
- API Key: Set `OPENAI_API_KEY` in `.env`. Pay-Per-Token.

solto only forwards `OPENAI_API_KEY` if it's set, so leaving it empty defers to whatever `codex login` saved.

**Claude Code**: set `CODER=claude` in `.env` and `ANTHROPIC_API_KEY=<your key>`. Optionally run `claude` once interactively to authenticate.

When `CODER=claude`, solto passes a Claude `--agents` set so the run can delegate research, bounded implementation and review work inside the same run. For broader tasks and PR follow-ups, solto automatically strengthens those delegation instructions and switches Claude into a more aggressive subagent mode. If you set `CODER=auto`, solto prefers Claude for more complex parallelizable tasks when `ANTHROPIC_API_KEY` is present and otherwise falls back to Codex. Set `CLAUDE_ENABLE_SUBAGENTS=0` in `.env` if you want to disable Claude subagents entirely.

Per-runner config (model, flags, permission mode) lives in `src/runners.ts`.

## 5. Set Up Public HTTPS (Cloudflare Tunnel)

Linear requires HTTPS. solto assumes [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). It's free, zero-firewall, gives automatic HTTPS and works wherever your domain is on [Cloudflare DNS](https://www.cloudflare.com/). `bootstrap.sh` already installed the [`cloudflared`](https://github.com/cloudflare/cloudflared) binary, so you just need to configure it.

```bash
# Authenticate (opens a browser URL; pick your Cloudflare-managed domain)
cloudflared tunnel login

# Create the named tunnel. Default name solto expects: "solto-tunnel".
cloudflared tunnel create solto-tunnel

# Write tunnel config (swap in your UUID and hostname)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: solto-tunnel
credentials-file: /home/agent/.cloudflared/<UUID>.json

ingress:
  - hostname: <your-host>.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
EOF

# Route DNS
cloudflared tunnel route dns solto-tunnel <your-host>.<your-domain>

# Verify it runs in foreground
cloudflared tunnel run solto-tunnel
```

## 6. Create Webhooks

Set one shared GitHub webhook secret in `.env` first:

```bash
openssl rand -hex 32
# copy the output into:
GITHUB_WEBHOOK_SECRET=<that-random-value>
```

After saving `.env`, restart solto so it picks up the new secret:

```bash
pm2 restart solto --update-env
```

Then, for each project in `projects.local.json`:

1. **Personal API key**: Linear → Settings → API → Personal API keys → New key. Paste into `.env` as `LINEAR_API_KEY`. Best practice: generate this key from the same dedicated automation user that will receive assignments, such as `solto-bot`, not from your personal Linear account.
2. **Linear webhook**:
   - URL: `https://<your-webhook-host>/webhook/<project-id>`
   - Resource types: **Issues** and **Comments**
   - Team: the team that owns the project
   - Copy the signing secret into `.env` as `<PROJECT_ID>_LINEAR_SECRET`
3. **GitHub webhook**:
   - Payload URL: `https://<your-webhook-host>/github-webhook`
   - Content type: `application/json`
   - Secret: the exact same `GITHUB_WEBHOOK_SECRET` value from `~/solto/.env`
   - Event: **Pull requests**
4. **Workflow setup**:
   - assign work to your bot user, for example `solto-bot`
   - keep issues in `Todo` / `To do` when you want them to start
   - <kbd>yolo</kbd> is optional and pushes directly to `main` instead of opening a PR
   - Linear's GitHub integration is optional; solto attaches its own PRs directly to the issue

## 7. Start solto

```bash
cd ~/solto
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Verify:

```bash
curl http://localhost:3000/health
curl https://<your-webhook-host>/health
./scripts/doctor.sh
```

## Environment Variables (`~/solto/.env`)

| Var | Purpose |
|---|---|
| `CODER` | `codex` (default), `claude`, or `auto` |
| `ANTHROPIC_API_KEY` | Headless Claude Code CLI (when `CODER=claude`) |
| `CLAUDE_ENABLE_SUBAGENTS` | Optional. `1` by default when `CODER=claude`; set `0` / `false` / `no` to disable Claude subagents |
| `CLAUDE_SUBAGENT_MODE` | Optional. `auto` by default. `standard` keeps the lighter subagent set, `aggressive` always pushes stronger parallel delegation, `off` disables `--agents` |
| `OPENAI_API_KEY` | Codex CLI (when `CODER=codex`). Leave empty to use `codex login` session |
| `LINEAR_API_KEY` | Linear personal API key for comments + state updates |
| `GITHUB_WEBHOOK_SECRET` | Shared GitHub webhook secret for merged PR callbacks |
| `LINEAR_BOT_MENTION` | Optional override for the bot mention alias used in follow-up comments |
| `<PROJECT>_LINEAR_SECRET` | Webhook signing secret per project |
| `STATUS_TOKEN` | Random token gating the `/status` endpoint |
| `TUNNEL_NAME` | Optional override for the cloudflared tunnel name |
| `AGENT_TIMEOUT_MS` | Optional override for per-run agent timeout (default 20 min) |

## Adding a Project After Install

```bash
# 1. Edit projects.local.json and add a new entry with id + githubRepo
# 2. Scaffold local state
./scripts/add-project.sh <new-id>
# 3. Create the Linear webhook and the repo's GitHub pull_request webhook
# 4. Reload
pm2 restart solto
```

## Triggering an Agent

Get the issue assigned to the bot user and into `Todo` / `To do`. The order does not matter. Once an update leaves the issue in that state, the webhook fires and solto:

1. Posts a comment, sets state → **In Progress**
2. Adds a git worktree off `origin/main`
3. Runs the selected coder headlessly
4. Commits + pushes a feature branch
5. Opens a PR via `gh pr create`, attaches it to the Linear issue, posts the URL, sets state → **In Review**
6. When GitHub later reports that the PR was merged, solto posts a follow-up comment and sets the issue → **Done**
7. Cleans up the worktree

If `yolo` is also present: pushes directly to `main`, sets state → **Done**. On failure / no-changes: comments the error, sets state → **Todo**.

To iterate on an open PR, add a new Linear comment that starts with the bot mention, usually `@solto-bot`. solto reuses the existing PR branch, makes another commit, pushes it to the same branch and comments back with the updated PR URL.

## Operations

All commands run as the `agent` user.

### Process Status

```bash
pm2 status
pm2 info solto
pm2 info cloudflare-tunnel
./scripts/doctor.sh
```

For a lightweight code-level sanity check:

```bash
pnpm test
```

### Start / Stop / Restart

```bash
cd ~/solto && pm2 start ecosystem.config.cjs

pm2 restart solto
pm2 restart cloudflare-tunnel
pm2 restart all

pm2 stop solto
pm2 delete solto
pm2 save
```

### Upgrade Solto

```bash
cd ~/solto
./scripts/upgrade.sh
```

By default this upgrades to the latest available release. You can also target:

```bash
./scripts/upgrade.sh latest
./scripts/upgrade.sh main
./scripts/upgrade.sh v0.1.0
```

### Logs

```bash
pm2 logs solto
pm2 logs solto --lines 200
pm2 logs solto --nostream
pm2 logs cloudflare-tunnel
pm2 logs
```

### Status endpoint

```bash
curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    https://<your-webhook-host>/status | jq

curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    "https://<your-webhook-host>/status?include=logs" | jq

curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    "https://<your-webhook-host>/status?include=logs&tail=5" | jq
```

`/status` returns:

- Live Per-Project Activity.
- `_recent` for the Latest Persisted Jobs.
- `_process` for Bounded PM2 Stats.
- `_version` From `package.json`.
- `_generatedAt` as the Snapshot Timestamp.

### Reconcile Missed Merge Events

```bash
cd ~/solto
pnpm reconcile --dry-run
pnpm reconcile
```

Use this if a PR was merged but the issue stayed in `In Review` or if you suspect stale PR state under `.solto-state/prs/`.

### Health Probes

```bash
curl https://<your-webhook-host>/health
curl http://localhost:3000/health
```
