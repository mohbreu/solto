# solto: Setup & Operations

Reference for installing and operating solto on your own Linux host. Paths assume Ubuntu 24.04 on the `agent` user, but anything Linux + [systemd](https://systemd.io/) / [pm2](https://pm2.keymetrics.io/) should work.

> **Before installing, read [README.md § Trust model](./README.md#-trust-model-read-before-deploying).** solto runs a coding agent with permissions bypassed on attacker-influenceable input. Anyone who can assign an issue to the bot user has what is effectively shell access to your host.

## Host dependencies: what solto needs to run

`scripts/bootstrap.sh` installs all of these on a fresh Ubuntu box. If you're installing by hand, here's the full list.

solto assumes [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for public HTTPS. It's free, needs no firewall changes, gives you automatic HTTPS, and works wherever your domain is on [Cloudflare DNS](https://www.cloudflare.com/). If you'd rather use something else ([nginx](https://nginx.org/) + [Let's Encrypt](https://letsencrypt.org/), [Caddy](https://caddyserver.com/), [ngrok](https://ngrok.com/)), swap it in. solto only cares that something forwards HTTPS to `localhost:3000`.

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

### External accounts / credentials

| Account | Used for |
|---|---|
| [GitHub](https://github.com/) (for the `agent` user) | `gh auth login`, with push + PR-create on target repos |
| [Linear](https://linear.app/) workspace | Personal API key (`LINEAR_API_KEY`) + one webhook per project with its signing secret |
| [GitHub](https://github.com/) target repos | One `pull_request` webhook per repo using `GITHUB_WEBHOOK_SECRET` so merged PRs can move issues to Done |
| [Anthropic API](https://console.anthropic.com/) key *or* [Claude subscription](https://www.anthropic.com/pricing#claude-code) | If `CODER=claude` |
| [OpenAI API](https://platform.openai.com/) key *or* [ChatGPT subscription](https://openai.com/chatgpt/pricing/) (`codex login`) | If `CODER=codex` (default) |
| A [Cloudflare](https://www.cloudflare.com/)-managed domain | For the Cloudflare Tunnel hostname |

Best practice: use a dedicated Linear user such as `solto-bot` for `LINEAR_API_KEY` so automation comments and state changes are isolated from your personal account.

## Target project requirements: what each repo needs to work with solto

For solto to open PRs against a GitHub repo, the repo must meet these conditions:

### Required

1. **GitHub-hosted**. solto clones via `gh repo clone <owner>/<repo>` and opens PRs via `gh pr create`.
2. **`agent` user has push + PR-create permission**. Configure this once via `gh auth login`. For org-owned repos, make sure the auth token has the right scopes and the user is a collaborator with at least Write access.
3. **A default branch exists**. `main` by default. If yours is different, set `githubBase` for that entry in `projects.local.json`.
4. **`AGENTS.md` at the repo root**. Both Claude Code and Codex read this natively. solto's agent prompt explicitly instructs the agent to read it first and follow every rule. Without one, the agent will guess at your conventions.

### What to put in `AGENTS.md`

Minimum contents for the agent to do good work:

- **Commit conventions**. solto assumes [Conventional Commits](https://www.conventionalcommits.org/) and expects the agent to commit changes itself. If you want something different, state it here.
- **PR conventions**. Title format, required sections in the body, attribution rules. solto writes the PR body from a file the agent produces (`/tmp/solto-pr-<id>.md`), so document what should and shouldn't appear in it (for example no ticket IDs and no self-attribution).
- **Code style**. Linter/formatter to run, strictness of types, naming rules.
- **Test policy**. Which test command to run, whether all tests must pass before committing, whether new code needs new tests.
- **Dependency policy**. Can the agent add packages? Which package manager?
- **Build/dev setup**. How to install deps, run the build, start the dev server. If env vars are needed, point at an `.env.example` or list what the agent can skip.
- **Files/directories the agent should never touch**. Infra, secrets, generated code.

### Linear setup (per project)

1. **Dedicated bot user** (required trigger). Best practice: use the same Linear user that owns `LINEAR_API_KEY`, for example `solto-bot`.
2. **`yolo` label** (optional). If present, solto pushes directly to the base branch instead of opening a PR.
3. **Conventional-commit type labels** (optional). solto picks up `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`, `revert`, or any `type:<x>` label, and uses it as the commit/PR type. Defaults to `chore`.
4. **Webhook**. URL `https://<your-host>/webhook/<project-id>`, resource types `Issues` and `Comments`, scoped to the team that owns the project. Paste the signing secret into `.env` as `<PROJECT_ID>_LINEAR_SECRET` (UPPER_SNAKE_CASE, dashes to underscores).

### How a good Linear issue looks

The issue **title** becomes the task summary. The issue **description** is passed verbatim to the agent. The more concrete the description, the better the result:

- State the desired outcome, not just "investigate".
- Reference file paths or symbols when you know them.
- Call out constraints (don't touch X, reuse Y).
- If the agent should verify something (tests pass, screenshot, specific behavior), say so.

Vague issues produce vague diffs. In some cases the agent comments "made no changes, task may already be complete" and bounces the issue back to Todo.

## File layout

```
~/solto/
  .env                     # secrets (NOT committed)
  projects.local.json      # per-project config (NOT committed)
  ecosystem.config.cjs     # pm2 process definitions
  package.json
  src/                     # solto source (TS, run via tsx)
  scripts/
    bootstrap.sh           # one-time host provisioning
    add-project.sh         # scaffolds a new project
    prune.sh               # cleans stale worktrees + merged branches
  repos/<project>/         # full clone of each repo (one per project)
  workers/<project>/<id>/  # ephemeral git worktrees, one per active job
  .solto-state/prs/        # local PR metadata so bot-mention comments can update an existing PR branch
~/.cloudflared/
  cert.pem                 # cloudflared account cert (from `tunnel login`)
  <UUID>.json              # tunnel credentials
  config.yml               # tunnel config (hostname → localhost:3000)
```

## Installing on a new machine

### 1. Fast path: one command on a fresh Ubuntu host

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | sudo bash
```

This does four things:

- runs `scripts/bootstrap.sh`
- clones or updates `~/solto`
- runs `pnpm install`
- seeds `.env` and `projects.local.json` from the examples if they are missing

It intentionally does not try to automate the interactive or environment-specific steps:

- `gh auth login`
- `codex login` or Claude auth / API key setup
- editing `.env`
- editing `projects.local.json`
- Cloudflare Tunnel login and DNS setup
- Linear webhook creation
- GitHub webhook creation

After the installer finishes, continue with:

1. [Authenticate the coder](#4-authenticate-the-coder)
2. [Set up public HTTPS](#5-set-up-public-https-cloudflare-tunnel)
3. [Create webhooks](#6-create-webhooks)
4. [Start solto](#7-start-solto)

### 2. Manual path: bootstrap only

If you want to provision the host without cloning/configuring the repo yet, use the old bootstrap-only flow:

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/scripts/bootstrap.sh | sudo bash
```

This creates the `agent` user (no sudo, intentionally) and installs `git`, `gh`, `jq`, Node LTS, pnpm, pm2, `cloudflared`, and both the [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) and [Codex](https://github.com/openai/codex) CLIs. On anything not Ubuntu, read the script and port it by hand.

### 3. Clone and configure solto (as the `agent` user)

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

### 4. Authenticate the coder

**Codex (default)**: two options:
- ChatGPT subscription: run `codex login` once (browser flow). Credentials land in `~/.codex/`. Leave `OPENAI_API_KEY` empty in `.env`.
- API key: set `OPENAI_API_KEY` in `.env`. Pay-per-token.

solto only forwards `OPENAI_API_KEY` if it's set, so leaving it empty defers to whatever `codex login` saved.

**Claude Code**: set `CODER=claude` in `.env` and `ANTHROPIC_API_KEY=<your key>`. Optionally run `claude` once interactively to authenticate.

When `CODER=claude`, solto also passes a small generic `--agents` set to Claude Code so it can delegate research, bounded implementation, and review work inside the same run. Set `CLAUDE_ENABLE_SUBAGENTS=0` in `.env` if you want to disable that.

Per-runner config (model, flags, permission mode) lives in `src/runners.ts`.

### 5. Set up public HTTPS ([Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/))

Linear requires HTTPS. solto assumes [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). It's free, zero-firewall, gives automatic HTTPS, and works wherever your domain is on [Cloudflare DNS](https://www.cloudflare.com/). `bootstrap.sh` already installed the [`cloudflared`](https://github.com/cloudflare/cloudflared) binary, so you just need to configure it.

```bash
# Authenticate (opens a browser URL; pick your Cloudflare-managed domain)
cloudflared tunnel login
# → ~/.cloudflared/cert.pem

# Create the named tunnel. Default name solto expects: "solto-tunnel".
# Override with TUNNEL_NAME=<name> in .env if you want a different name.
cloudflared tunnel create solto-tunnel
# → ~/.cloudflared/<UUID>.json

# Write tunnel config (swap in your UUID and hostname)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: solto-tunnel
credentials-file: /home/agent/.cloudflared/<UUID>.json

ingress:
  - hostname: <your-host>.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
EOF

# Route DNS (creates the CNAME in Cloudflare automatically)
cloudflared tunnel route dns solto-tunnel <your-host>.<your-domain>

# Verify it runs in foreground
cloudflared tunnel run solto-tunnel
# Ctrl+C once you see it connect; pm2 will manage it from here
```

### 6. Create webhooks

Set one shared GitHub webhook secret in `.env` first:

```bash
GITHUB_WEBHOOK_SECRET=<random-secret>
```

Then, for each project in `projects.local.json`:

1. **Personal API key** (one-time): Linear → Settings → API → Personal API keys → New key. Paste into `.env` as `LINEAR_API_KEY`. Best practice: generate this key from a dedicated automation user such as `solto-bot`, not from your personal Linear account.
2. **Linear webhook**: Linear → Settings → API → Webhooks → New webhook.
   - URL: `https://<your-webhook-host>/webhook/<project-id>`
   - Resource types: **Issues** and **Comments**
   - Team: the team that owns the project
   - Copy the signing secret → `.env` as `<PROJECT_ID>_LINEAR_SECRET` (UPPER_SNAKE_CASE form of the id).
3. **GitHub webhook**: GitHub repo → Settings → Webhooks → Add webhook.
   - Payload URL: `https://<your-webhook-host>/github-webhook`
   - Content type: `application/json`
   - Secret: the shared `GITHUB_WEBHOOK_SECRET`
   - Event: **Pull requests**
4. **Workflow setup**:
   - assign work to your bot user, for example `solto-bot`
   - keep issues in `Todo` / `To do` when you want them to start
   - `yolo` is optional and pushes directly to `main` instead of opening a PR

### 7. Start solto

```bash
cd ~/solto
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # follow the printed sudo command for boot persistence
```

Verify:

```bash
curl http://localhost:3000/health                       # → ok
curl https://<your-webhook-host>/health                 # → ok (via tunnel)
./scripts/doctor.sh                                     # full local setup check
```

## Environment variables (`~/solto/.env`)

| Var | Purpose |
|---|---|
| `CODER` | `codex` (default) or `claude` |
| `ANTHROPIC_API_KEY` | Headless Claude Code CLI (when `CODER=claude`) |
| `CLAUDE_ENABLE_SUBAGENTS` | Optional. `1` by default when `CODER=claude`; set `0` / `false` / `no` to disable Claude subagents |
| `OPENAI_API_KEY` | Codex CLI (when `CODER=codex`). Leave empty to use `codex login` session |
| `LINEAR_API_KEY` | Linear personal API key for comments + state updates |
| `GITHUB_WEBHOOK_SECRET` | Shared GitHub webhook secret for merged PR callbacks |
| `LINEAR_BOT_MENTION` | Optional override for the bot mention alias used in follow-up comments |
| `<PROJECT>_LINEAR_SECRET` | Webhook signing secret per project (e.g. `MY_PROJECT_LINEAR_SECRET`) |
| `STATUS_TOKEN` | Random token gating the `/status` endpoint |
| `TUNNEL_NAME` | Optional override for the cloudflared tunnel name |
| `AGENT_TIMEOUT_MS` | Optional override for per-run agent timeout (default 20 min) |

## Adding a project after install

```bash
# 1. Edit projects.local.json and add a new entry with id + githubRepo
# 2. Scaffold local state
./scripts/add-project.sh <new-id>
# 3. Create the Linear webhook and the repo's GitHub pull_request webhook
# 4. Reload
pm2 restart solto
```

## Triggering an agent

Get the issue assigned to the bot user and into `Todo` / `To do`. The order does not matter. Once an update leaves the issue in that state, the webhook fires and solto:

1. Posts a comment, sets state → **In Progress**
2. Adds a git worktree off `origin/main`
3. Runs the selected coder headlessly
4. Commits + pushes a feature branch
5. Opens a PR via `gh pr create`, posts the URL, sets state → **In Review**
6. When GitHub later reports that the PR was merged, solto posts a follow-up comment and sets the issue → **Done**
7. Cleans up the worktree

If `yolo` is also present: pushes directly to `main`, sets state → **Done**. On failure / no-changes: comments the error, sets state → **Todo**.

To iterate on an open PR, add a new Linear comment that starts with the bot mention, usually `@solto-bot`. solto reuses the existing PR branch, makes another commit, pushes it to the same branch, and comments back with the updated PR URL. If your workspace uses a different mention alias than the bot display name suggests, set `LINEAR_BOT_MENTION` in `.env`.

## Repo conventions for agents

Each project repo should have an `AGENTS.md` at its root with project-specific instructions (style, commands, dependencies policy). Claude Code and Codex both read it natively.

## Operations cheat sheet

All commands run as the `agent` user.

### Process status

```bash
pm2 status
pm2 info solto
pm2 info cloudflare-tunnel
./scripts/doctor.sh
```

`./scripts/doctor.sh` is the first thing to run when solto stops picking up work or auth looks suspect. It checks the local env, pm2 runtime env, repo access, Linear API token, and local health endpoints, and exits non-zero on hard failures.

For a lightweight code-level sanity check:

```bash
pnpm test
```

GitHub Actions also runs this test suite on every pull request and every push to `main`.

### Start / stop / restart

```bash
cd ~/solto && pm2 start ecosystem.config.cjs

pm2 restart solto              # after .env or code change
pm2 restart cloudflare-tunnel
pm2 restart all

pm2 stop solto
pm2 delete solto
pm2 save                       # persist pm2 state across reboots
```

### Logs

```bash
pm2 logs solto
pm2 logs solto --lines 200
pm2 logs solto --nostream
pm2 logs cloudflare-tunnel
pm2 logs                       # everything

pm2 flush                      # clear all logs
```

Raw log files: `~/.pm2/logs/`.

### What the agents are doing right now

```bash
curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    https://<your-webhook-host>/status | jq

curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    "https://<your-webhook-host>/status?include=logs" | jq

curl -H "x-status-token: $(grep STATUS_TOKEN ~/solto/.env | cut -d= -f2)" \
    "https://<your-webhook-host>/status?include=logs&tail=5" | jq

pm2 logs solto -f

# Worktrees on disk = jobs in flight
ls ~/solto/workers/<project>/

# Inspect an in-flight worktree
git -C ~/solto/workers/<project>/<issue-id>/ status
```

`/status` returns:

- live per-project activity
- `_recent` for the latest persisted jobs, including interrupted runs after a restart
- `_process` for bounded pm2 stats on `solto` and `cloudflare-tunnel`
- `_generatedAt` as the snapshot timestamp

Add `?include=logs` for a short pm2 log tail without opening `pm2 logs`.

Use `tail=<n>` to change the log limit. The server clamps it to a small safe range and removes repeated startup noise so the tail stays readable.

In Linear: every issue assigned to the bot user self-narrates via comments (start → workspace ready → PR opened / failed / no-changes) and moves through workflow states.

### Health probes

```bash
curl https://<your-webhook-host>/health   # public, via tunnel
curl http://localhost:3000/health         # local, bypasses tunnel
```

If `localhost:3000/health` works but the public URL doesn't → tunnel issue (`pm2 logs cloudflare-tunnel`). If neither works → solto issue (`pm2 logs solto`).

### Updating solto

```bash
cd ~/solto
git pull
pnpm install
pm2 restart solto
pm2 logs solto --lines 30 --nostream
```

### Updating dependencies

```bash
cd ~/solto
pnpm update
pm2 restart solto

# Claude Code CLI
~/.local/bin/claude update
pm2 restart solto

# Codex CLI
npm i -g @openai/codex@latest
pm2 restart solto

# cloudflared
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o ~/.local/bin/cloudflared
chmod +x ~/.local/bin/cloudflared
pm2 restart cloudflare-tunnel
```

### Boot persistence

The `agent` user has no sudo. Run `pm2 startup` once from your initial sudo-capable user (e.g. `ubuntu`):

```bash
# As the sudo-capable bootstrap user (NOT as agent):
sudo env PATH=$PATH:/home/agent/.local/share/mise/installs/node/lts/bin \
    pm2 startup systemd -u agent --hp /home/agent
# Follow any printed instructions.

# Then back as 'agent':
pm2 save
```

Verify after a reboot: `pm2 status`. Both processes should come back online.

### Killing a stuck job

```bash
curl -H "x-status-token: $TOKEN" https://<your-webhook-host>/status | jq

# Hard reset: restart solto (drops all in-flight workers)
pm2 restart solto

# Prune leftover worktrees
ls ~/solto/workers/<project>/
git -C ~/solto/repos/<project> worktree remove ~/solto/workers/<project>/<id> --force
git -C ~/solto/repos/<project> worktree prune
```

### Pruning stale state

Run every couple of weeks:

```bash
cd ~/solto
pnpm prune
```

For each project in `repos/` this:

- `git fetch --prune origin`
- `git worktree prune`
- deletes local branches merged into `origin/<base>`
- deletes **remote** branches merged into `origin/<base>` (base itself is skipped)
- removes orphan empty dirs in `workers/<project>/`

Script lives at `scripts/prune.sh`. Safe to re-run. It only deletes branches already merged into the base branch.

### Rotating secrets

After changing anything in `.env`:

```bash
pm2 restart solto
```

The tunnel doesn't read `.env`, so there is no need to restart it.

## Git identity for commits the agent makes

solto commits via whatever global git config the `agent` user has. Set it once:

```bash
git config --global user.name  "<your-name>"
git config --global user.email "<your-email>"
```
