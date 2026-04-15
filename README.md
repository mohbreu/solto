![solto banner](./assets/readme-banner.jpg)

# solto [![Test](https://github.com/mohbreu/solto/actions/workflows/test.yml/badge.svg)](https://github.com/mohbreu/solto/actions/workflows/test.yml)

Self-hosted orchestrator that turns assigned [Linear](https://linear.app/) issues into GitHub pull requests by running a coding agent ([Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or [OpenAI Codex](https://github.com/openai/codex)) in a dedicated [git worktree](https://git-scm.com/docs/git-worktree) per issue.

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

## Requirements

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

For runtime checks:

```bash
curl -H "x-status-token: <STATUS_TOKEN>" https://<your-webhook-host>/status | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs" | jq
curl -H "x-status-token: <STATUS_TOKEN>" "https://<your-webhook-host>/status?include=logs&tail=5" | jq
```

`/status` includes live per-project job counts, recent persisted jobs, bounded pm2 stats, and a response timestamp. Add `?include=logs` for a compact log tail, and `tail=<n>` to control its size.

## License

ISC

---

<p align="center">
<svg class="credit" xmlns="http://www.w3.org/2000/svg" width="135" height="13" fill="none" viewBox="0 0 135 13"><g clip-path="url(#a)"><path fill="#ddd" d="m74.65 2.01-3.53 4a1 1 0 0 0 .75 1.66h3.16a1 1 0 0 1 .9.55l1.44 2.9a1 1 0 0 0 .9.55h4.44a1 1 0 0 0 .74-.32l3.68-4.02a1 1 0 0 0-.73-1.67l-3.66-.03a1 1 0 0 1-.87-.52L80.29 2.2a1 1 0 0 0-.88-.53h-4a1 1 0 0 0-.76.34"></path></g><path fill="#ddd" d="M56.83 11.3c-2.27 0-2.74-.72-2.74-4.2s.47-4.2 2.74-4.2c2.24 0 2.72.71 2.72 4.2 0 3.48-.48 4.2-2.72 4.2m0-1.08c1.27 0 1.54-.52 1.54-3.13 0-2.59-.27-3.12-1.54-3.12-1.28 0-1.56.53-1.56 3.13s.28 3.12 1.56 3.12M47.92 11.17V3.01h1.18v7.1h3.64v1.06zM40.76 3.01h1.18v5.52c0 1.4.24 1.7 1.37 1.7 1.11 0 1.35-.3 1.35-1.7V3.01h1.17v5.52c0 2.3-.43 2.76-2.52 2.76-2.1 0-2.55-.47-2.55-2.76zM33.53 11.17l2.1-8.16h1.84l2.09 8.16h-1.14l-.5-1.94h-2.77l-.48 1.94zm1.9-2.99h2.23l-1.02-4.14h-.2zM27.56 11.17V3.01c.48-.05 1.05-.05 1.56-.05 2.72.02 3.3.5 3.3 2.68 0 2.03-.48 2.45-2.77 2.45h-.93v3.08zm1.16-4.15h.84c1.39 0 1.69-.26 1.69-1.45 0-1.26-.36-1.54-1.89-1.54h-.64zM16.26 11.3c-2.27 0-2.74-.72-2.74-4.2s.47-4.2 2.74-4.2c2.24 0 2.72.71 2.72 4.2 0 3.48-.48 4.2-2.72 4.2m0-1.08c1.27 0 1.54-.52 1.54-3.13 0-2.59-.27-3.12-1.54-3.12-1.28 0-1.56.53-1.56 3.13s.28 3.12 1.56 3.12M6.49 11.17l2.08-8.16h1.85l2.1 8.16h-1.15l-.5-1.94H8.1l-.48 1.94zm1.9-2.99h2.22L9.6 4.04H9.4zm0-6.73h-.86C7.53.22 7.7 0 8.63 0c.54 0 .71.07 1.18.64.29.33.37.38.52.38.22 0 .26-.1.26-.7h.85c0 1.25-.17 1.48-1.1 1.48-.58 0-.7-.08-1.12-.59-.27-.35-.37-.43-.57-.43-.23 0-.27.08-.27.67M0 9.13h1.14c.06.91.35 1.1 1.63 1.1 1.29 0 1.55-.21 1.55-1.27 0-.93-.28-1.18-1.57-1.48C.53 6.96.06 6.55.06 5.05c0-1.79.46-2.16 2.69-2.16 2.09 0 2.52.33 2.57 1.86H4.19c-.04-.65-.29-.79-1.42-.79-1.3 0-1.57.2-1.57 1.1 0 .76.28.99 1.62 1.29 2.2.51 2.65.95 2.65 2.61 0 1.94-.48 2.33-2.8 2.33-2.23 0-2.7-.36-2.67-2.16M129.4 11.17V3.01h1.17v7.1h3.65v1.06zM122.8 11.17v-1.03h1.4V4.06h-1.32V3h3.81v1.05h-1.34v6.08h1.4v1.03zM115.29 9.13h1.14c.06.91.34 1.1 1.63 1.1s1.55-.21 1.55-1.27c0-.93-.28-1.18-1.58-1.48-2.22-.52-2.68-.93-2.68-2.43 0-1.79.45-2.16 2.68-2.16 2.1 0 2.52.33 2.57 1.86h-1.13c-.03-.65-.28-.79-1.41-.79-1.3 0-1.57.2-1.57 1.1 0 .76.27.99 1.62 1.29 2.2.51 2.65.95 2.65 2.61 0 1.94-.48 2.33-2.8 2.33-2.23 0-2.7-.36-2.67-2.16M108.25 11.17l2.09-8.16h1.84l2.1 8.16h-1.15l-.5-1.94h-2.76l-.48 1.94zm1.9-2.99h2.23l-1.02-4.14h-.2zM102.12 11.17V3.01a29 29 0 0 1 2.3-.03c2.17.02 2.61.4 2.61 2.28 0 1.56-.23 1.9-1.34 2.02v.08c.64.12.85.36 1.11 1.4l.65 2.41h-1.28l-.53-2.36c-.2-.9-.47-1.08-1.6-1.08h-.78v3.44zm1.14-4.49h1.53c.9 0 1.09-.25 1.09-1.42 0-.95-.27-1.17-1.55-1.2a7 7 0 0 0-1.07 0zM95.38 11.17V3.01c.52-.05.8-.06 1.66-.06 2.57 0 3.1.39 3.1 2.23 0 1.2-.2 1.48-1.13 1.7v.03c1.2.35 1.45.71 1.45 2.1 0 1.89-.53 2.27-3.1 2.27-.87 0-1.2-.01-1.98-.1m1.14-3.68v2.69c.36.04.58.06 1.22.04 1.3-.04 1.56-.26 1.56-1.2 0-1.27-.27-1.53-1.56-1.53zm0-1.03h1.22c1.04 0 1.26-.2 1.26-1.25 0-.84-.22-1.06-1.26-1.17-.39-.04-.6-.06-1.22-.02z"></path><defs><clipPath id="a"><path fill="#ddd" d="M70.36 1.17h18v11h-18z"></path></clipPath></defs></svg>
</p>
