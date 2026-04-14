const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const tunnelName = process.env.TUNNEL_NAME || "solto-tunnel";

module.exports = {
  apps: [
    {
      name: "solto",
      script: "pnpm",
      args: "start",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "cloudflare-tunnel",
      script: "cloudflared",
      args: `tunnel run ${tunnelName}`,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
