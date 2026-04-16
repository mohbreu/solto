#!/usr/bin/env bash

set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-solto-tunnel}"
HOSTNAME="${1:-}"
CLOUDFLARED_DIR="${HOME}/.cloudflared"

if [ -z "$HOSTNAME" ]; then
  echo "Usage: ./scripts/setup-tunnel.sh <public-hostname>" >&2
  exit 1
fi

mkdir -p "$CLOUDFLARED_DIR"

if [ ! -f "$CLOUDFLARED_DIR/cert.pem" ]; then
  echo "--- Authenticating cloudflared"
  cloudflared tunnel login
fi

tunnel_id="$(
  cloudflared tunnel list 2>/dev/null \
    | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}'
)"

if [ -z "$tunnel_id" ]; then
  echo "--- Creating tunnel $TUNNEL_NAME"
  cloudflared tunnel create "$TUNNEL_NAME"
  tunnel_id="$(
    cloudflared tunnel list 2>/dev/null \
      | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}'
  )"
fi

if [ -z "$tunnel_id" ]; then
  echo "Could not determine tunnel ID for $TUNNEL_NAME" >&2
  exit 1
fi

credentials_file="$CLOUDFLARED_DIR/${tunnel_id}.json"
if [ ! -f "$credentials_file" ]; then
  echo "Missing credentials file: $credentials_file" >&2
  echo "If this tunnel already existed before this machine, create a new tunnel name or remove the old tunnel and recreate it here." >&2
  exit 1
fi

echo "--- Routing DNS for $HOSTNAME"
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

echo "--- Writing $CLOUDFLARED_DIR/config.yml"
cat > "$CLOUDFLARED_DIR/config.yml" <<EOF
tunnel: ${tunnel_id}
credentials-file: ${credentials_file}

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:3000
  - service: http_status:404
EOF

echo ""
echo "--- Tunnel ready"
echo "    tunnel:   $TUNNEL_NAME ($tunnel_id)"
echo "    hostname: $HOSTNAME"
echo ""
echo "Next:"
echo "  pm2 start ecosystem.config.cjs"
echo "  curl https://${HOSTNAME}/health"
