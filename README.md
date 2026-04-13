# solto

Self-hosted orchestrator that turns assigned [Linear](https://linear.app/) issues into GitHub pull requests by running a coding agent ([Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or [OpenAI Codex](https://github.com/openai/codex)) in a dedicated [git worktree](https://git-scm.com/docs/git-worktree) per issue.

## How it works

1. You assign a Linear issue to your dedicated bot user, such as `solto-bot`.
2. Linear hits a webhook served by solto (via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).
3. solto creates a git worktree off `origin/main`, runs the agent headlessly against it, commits the diff, pushes the branch, and opens a PR via [`gh`](https://cli.github.com/).
4. If solto already opened a PR for that issue, a later Linear comment that starts with `@solto-bot` updates the same PR branch.
5. The Linear issue self-narrates through comments and workflow states.

An issue can trigger solto in either of these ways:

- create the issue in `Todo` / `To do` already assigned to the bot user
- assign an existing issue to the bot user while it is already in `Todo` / `To do`
- move an issue into `Todo` / `To do` while it is already assigned to the bot user

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

## License

ISC
