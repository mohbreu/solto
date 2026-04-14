![solto banner](./assets/readme-banner.jpg)

# solto [![Test](https://github.com/mohbreu/solto/actions/workflows/test.yml/badge.svg)](https://github.com/mohbreu/solto/actions/workflows/test.yml)

Self-hosted orchestrator that turns assigned [Linear](https://linear.app/) issues into GitHub pull requests by running a coding agent ([Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or [OpenAI Codex](https://github.com/openai/codex)) in a dedicated [git worktree](https://git-scm.com/docs/git-worktree) per issue.

## How it works

1. You assign a Linear issue to your dedicated bot user, such as `solto-bot`.
2. Linear hits a webhook served by solto (via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).
3. solto creates a git worktree off `origin/main`, runs the agent headlessly against it, commits the diff, pushes the branch, and opens a PR via [`gh`](https://cli.github.com/).
4. If solto already opened a PR for that issue, a later Linear comment that starts with `@solto-bot` updates the same PR branch.
5. The Linear issue self-narrates through comments and workflow states.

When `CODER=claude`, solto enables a small default set of Claude subagents for research, bounded implementation, and review. The main agent still owns the final branch and PR.

An issue starts when it ends up both:

- assigned to the bot user
- in `Todo` / `To do`

Commit and branch naming are driven by Linear labels:

- `type:feat`, `type:fix`, `type:docs`, `type:chore`, etc. set the Conventional Commit type solto uses
- bare labels like `feat`, `fix`, `docs`, and `chore` also work
- that type is used for both the branch name and the fallback commit message, for example `docs/MOBILE-123-update-readme` and `docs: Update README`
- if no type label is present, solto defaults to `chore`

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

## Practical requirements

At a practical level, solto needs:

- A Linux host with a dedicated `agent` user
- [Node LTS](https://nodejs.org/), [pnpm](https://pnpm.io/), [pm2](https://pm2.keymetrics.io/), [git](https://git-scm.com/), [`gh`](https://cli.github.com/), and [`jq`](https://jqlang.org/)
- One coding agent CLI: [Codex](https://github.com/openai/codex) (default) or [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)
- Public HTTPS to `localhost:3000` for Linear webhooks. The default setup uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), but any HTTPS ingress works.
- A [Linear](https://linear.app/) workspace and a [GitHub](https://github.com/) account that can push branches and open PRs on your target repos

Your target repo should:

- Live on GitHub
- Have a default branch (`main` unless you override `githubBase`)
- Have an `AGENTS.md` at the repo root with code style, test commands, dependency policy, and any "don't touch this" rules
- Be usable non-interactively by the agent. If it needs env vars or special setup, document that in `AGENTS.md` or provide an `.env.example`

## Running Multiple Repos

Use one `solto` instance for many repos. Add each target repo to `projects.local.json`, run `./scripts/add-project.sh <id>`, create one Linear webhook per project id, add the matching `<ID>_LINEAR_SECRET` to `.env`, and restart `solto`.

Each project gets:

- its own clone under `repos/<id>/`
- its own worktrees under `workers/<id>/`
- its own concurrency and rate-limit settings in `projects.local.json`

## Install

Use [SETUP.md](./SETUP.md) for the full install and operations guide. It covers host setup, Linear webhook setup, multi-project setup, env vars, restarts, and day-to-day operations.

Fast path on a fresh Ubuntu host:

```bash
curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/install.sh | sudo bash
```

That installs host dependencies, clones `solto` into `/home/agent/solto`, runs `pnpm install`, and seeds `.env` plus `projects.local.json` if they do not exist yet. You still need to do the interactive/operator-specific steps afterward: `gh auth login`, coder auth, `.env` values, project config, webhook setup, and tunnel setup.

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

For runtime checks:

```bash
curl -H "x-status-token: <STATUS_TOKEN>" https://<your-webhook-host>/status | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs" | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs&tail=5" | jq
```

`/status` includes live per-project job counts, recent persisted jobs, bounded pm2 stats, and a response timestamp. Add `?include=logs` for a compact log tail, and `tail=<n>` to control its size.

## License

ISC
