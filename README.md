![solto banner](./assets/readme-banner.jpg)

# solto [![Test](https://github.com/mohbreu/solto/actions/workflows/test.yml/badge.svg)](https://github.com/mohbreu/solto/actions/workflows/test.yml)

Free, self-hosted, and open source alternative to Linear Agents.

Self-hosted orchestrator that turns assigned [Linear](https://linear.app/) issues into GitHub pull requests by running a coding agent ([Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or [OpenAI Codex](https://github.com/openai/codex)) in a dedicated [git worktree](https://git-scm.com/docs/git-worktree) per issue.

## Demo

<p align="center">
  <video src="https://github.com/user-attachments/assets/fdbf9c3c-c997-4a67-88bd-e5555f60641e" controls muted playsinline></video>
</p>

<p align="center">
  <small>quick demo of how to manage a GitHub repository via Linear with solto</small>
</p>

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | bash
```

Run it as root, or prefix it with `sudo` if needed. The installer needs root because it installs host packages and creates the locked-down `agent` user. After that, solto itself runs as `agent`, not root.

## Upgrade

```bash
cd ~/solto
./scripts/upgrade.sh
```

That upgrades to the latest available release, refreshes dependencies, and reloads `pm2`. For the full setup and operations guide, including `latest`, `main`, and pinned-tag examples, see [ZERO_TO_SOLTO.md](./ZERO_TO_SOLTO.md).

After install or any auth/config change, run:

```bash
./scripts/doctor.sh
```

It verifies the local env, project config, repo access, pm2 state, Linear token, and local `/health` + `/status`.

For a quick local sanity check:

```bash
pnpm test
```

The lightweight test suite covers local state persistence plus a few pure status/log helpers. It also runs in GitHub Actions for every pull request and every push to `main`.

## How it works

1. You assign a Linear issue to your dedicated bot user, such as `solto-bot`.
2. Linear hits a webhook served by solto (via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).
3. solto creates a git worktree off `origin/main`, runs the agent headlessly against it, commits the diff, pushes the branch, opens a PR via [`gh`](https://cli.github.com/), and attaches that PR to the Linear issue.
4. If solto already opened a PR for that issue, a later Linear comment that starts with `@solto-bot` updates the same PR branch.
5. When the PR is merged, GitHub calls back into solto and the Linear issue moves to `Done`.
6. The Linear issue self-narrates through comments and workflow states.

When `CODER=claude`, solto enables Claude subagents for research, implementation, and review. If you set `CODER=auto`, solto prefers Claude for broader parallelizable work when `ANTHROPIC_API_KEY` is present, and otherwise falls back to Codex.

An issue starts when it ends up both:

- Assigned to the Bot User.
- In `Todo` / `To do`.

Commit and branch naming are driven by Linear labels:

- `type:feat`, `type:fix`, `type:docs`, `type:chore`, etc. Set the Conventional Commit Type Solto Uses.
- Bare Labels Like `feat`, `fix`, `docs`, and `chore` Also Work.
- That Type Is Used for Both the Branch Name and the Fallback Commit Message, for Example `docs/MOBILE-123-update-readme` and `docs: Update README`.
- If No Type Label Is Present, Solto Defaults to `chore`.

Add the `yolo` label to push directly to `main` instead of opening a PR.

For follow-up changes on an existing PR, comment with the bot mention, usually `@solto-bot`.

```text
@solto-bot address the review feedback about dependency versions and rerun lint
```

<details>
<summary><strong>⚠ Trust model: read before deploying</strong></summary>

solto runs a coding agent with `--dangerously-skip-permissions` (Claude Code) / `--dangerously-bypass-approvals-and-sandbox` (Codex) on attacker-influenceable input. Treat assigning an issue to the bot user as **shell access to the host**.

- Issue title and description go straight into the agent prompt, so prompt injection is real.
- The agent can read and write the repo, use authenticated `gh`, and do whatever the `agent` OS user can do.
- solto does not forward unrelated webhook secrets to agent runs, but anything the OS user can reach is still in scope.

- Only let trusted people assign issues to the bot user.
- Run solto on a dedicated host or at least a locked-down OS user with no unrelated secrets.
- The `agent` user created by `bootstrap.sh` has no sudo access. Keep it that way.

</details>

## Requirements

- A Linux Host With a Dedicated `agent` User.
- [Node LTS](https://nodejs.org/), [pnpm](https://pnpm.io/), [pm2](https://pm2.keymetrics.io/), [git](https://git-scm.com/), [`gh`](https://cli.github.com/), and [`jq`](https://jqlang.org/).
- One Coding Agent CLI: [Codex](https://github.com/openai/codex) (Default) or [Claude Code](https://docs.claude.com/en/docs/claude-code/overview).
- Public HTTPS to `localhost:3000` for Linear Webhooks. The Default Setup Uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), but Any HTTPS Ingress Works.
- A [Linear](https://linear.app/) Workspace and a [GitHub](https://github.com/) Account That Can Push Branches and Open PRs on Your Target Repos.

Your target repo should live on GitHub, have a default branch, and include a root `AGENTS.md` with code style, test commands, dependency policy, and any “don’t touch this” rules. If the repo needs env vars or special setup, document that in `AGENTS.md` or provide an `.env.example`.

## Running Multiple Projects

One `solto` instance can handle many repo/team pairs. Treat each entry in `projects.local.json` as one project: one GitHub repo, one Linear team webhook, one local clone, one worktree namespace, and its own rate limits. Add a project by updating `projects.local.json`, running `./scripts/add-project.sh <id>`, creating that project’s Linear webhook, creating the repo’s GitHub `pull_request` webhook, and restarting `solto`. Use one shared `GITHUB_WEBHOOK_SECRET` for all GitHub repo webhooks.

Each project stays isolated:

- `repos/<id>/` Holds the Repo Clone.
- `workers/<id>/` Holds the Active Worktrees.
- `projects.local.json` Controls Concurrency and Rate Limits.
- `/status` Shows Each Project Independently.

For runtime checks:

```bash
curl -H "x-status-token: <STATUS_TOKEN>" https://<your-webhook-host>/status | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs" | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs&tail=5" | jq
```

`/status` includes live per-project activity, persisted recent jobs, bounded pm2 stats, `_version`, and a response timestamp. Add `?include=logs` for a compact log tail, and `tail=<n>` to control its size.

## License

ISC

---

<p align="center">
  <img src="./assets/footer-credit.svg" alt="Sao Paulo, Brazil" style="opacity: 0.45;" />
</p>
