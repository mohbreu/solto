#!/usr/bin/env bash
# solto bootstrap: installs system prerequisites on a fresh Ubuntu host.
#
# Run as root (or the initial sudo-capable user — e.g. `ubuntu` on Lightsail):
#   curl -fsSL https://raw.githubusercontent.com/mohbreu/solto/main/scripts/bootstrap.sh | sudo bash
#
# What this does:
#   - creates the 'agent' user (passwordless sudo)
#   - installs git, curl, ca-certificates, jq, nginx, gh
#   - as 'agent': installs Claude Code, mise, Node LTS, pnpm, pm2, and both
#     Claude Code and Codex CLIs
#
# After this finishes, log in as the 'agent' user and follow SETUP.md to clone
# the solto repo and configure projects.

set -euo pipefail

echo "--- Creating agent user"
# The 'agent' user deliberately has NO sudo. solto never needs sudo at runtime;
# a prompt-injected coder run must not be able to escalate. The one-time
# `pm2 startup` step for boot persistence runs from the initial sudo-capable
# user, not from 'agent'.
if ! id agent &>/dev/null; then
    useradd -m -s /bin/bash agent
    echo "agent user created (no sudo — intentional)"
else
    echo "agent user already exists, skipping"
fi

echo "--- Installing system packages"
apt-get update -q
apt-get install -y git curl ca-certificates jq nginx

echo "--- Installing GitHub CLI"
if ! command -v gh >/dev/null 2>&1; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
https://cli.github.com/packages stable main" \
        | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update -q && apt-get install -y gh
else
    echo "gh already installed, skipping"
fi

echo "--- Running agent user setup"
sudo -u agent bash << 'AGENT_SETUP'
set -euo pipefail

echo "--- Installing Claude Code CLI"
curl -fsSL https://claude.ai/install.sh | bash
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc \
    || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

echo "--- Installing mise"
curl https://mise.run | sh
grep -qxF 'eval "$(~/.local/bin/mise activate bash)"' ~/.bashrc \
    || echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc

export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"

echo "--- Installing Node LTS + pnpm + pm2"
mise use --global node@lts
mise use --global npm:pnpm npm:pm2

echo "--- Installing Codex CLI"
npm i -g @openai/codex

echo ""
echo "--- Agent user setup complete"
echo "    claude: $(claude --version 2>/dev/null || echo 'not on PATH yet — reopen shell')"
echo "    codex:  $(codex --version 2>/dev/null || echo 'not on PATH yet — reopen shell')"
echo "    node:   $(node --version)"
echo "    pnpm:   $(pnpm --version)"
echo "    pm2:    $(pm2 --version)"
AGENT_SETUP

cat <<'EOF'

--- Bootstrap complete

Next steps (as the 'agent' user):

  sudo su - agent
  gh auth login
  git clone https://github.com/mohbreu/solto.git ~/solto
  cd ~/solto
  pnpm install
  cp .env.example .env                              # fill in API keys + STATUS_TOKEN
  cp projects.local.json.example projects.local.json # list your projects
  for id in $(jq -r '.[].id' projects.local.json); do
      ./scripts/add-project.sh "$id"
  done
  # Create a Linear webhook per project, paste each <ID>_LINEAR_SECRET into .env
  # Set up a Cloudflare Tunnel (see SETUP.md) for public HTTPS
  pm2 start ecosystem.config.cjs
  pm2 save
  pm2 startup   # follow printed sudo command for boot persistence
EOF
