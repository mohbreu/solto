#!/usr/bin/env bash
# Prune stale worktrees and merged branches across all project repos.
# Run every couple of weeks: `pnpm prune`

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOS_DIR="$ROOT/repos"
WORKERS_DIR="$ROOT/workers"

if [ ! -d "$REPOS_DIR" ]; then
    echo "No repos directory at $REPOS_DIR"
    exit 0
fi

for repo in "$REPOS_DIR"/*/; do
    [ -d "$repo" ] || continue
    project="$(basename "$repo")"
    echo
    echo "=== $project ==="

    cd "$repo"

    echo "→ fetching + pruning remote refs"
    git fetch --prune origin

    echo "→ pruning stale worktrees"
    git worktree prune -v

    echo "→ active worktrees:"
    git worktree list

    base="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main)"

    echo "→ deleting local branches merged into origin/$base"
    git branch --merged "origin/$base" \
        | grep -vE "^\*|^\s*$base$" \
        | xargs -r -n1 git branch -d || true

    echo "→ deleting remote branches merged into origin/$base (skipping protected base)"
    merged_remote=$(git branch -r --merged "origin/$base" \
        | grep -v "origin/HEAD" \
        | grep -v "origin/$base$" \
        | sed 's|origin/||' \
        | xargs -r)
    if [ -n "$merged_remote" ]; then
        for b in $merged_remote; do
            echo "  deleting remote $b"
            git push origin --delete "$b" || true
        done
    else
        echo "  (none)"
    fi

    worker_project_dir="$WORKERS_DIR/$project"
    if [ -d "$worker_project_dir" ]; then
        echo "→ cleaning orphan worker dirs in $worker_project_dir"
        find "$worker_project_dir" -mindepth 1 -maxdepth 1 -type d -empty -exec rmdir {} \; 2>/dev/null || true
    fi
done

echo
echo "Done."
