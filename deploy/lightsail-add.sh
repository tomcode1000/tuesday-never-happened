#!/usr/bin/env bash
# Add "Tuesday Never Happened" to an EXISTING Lightsail box that already runs Caddy (e.g. the Detour server).
# It never touches the other apps: own folder, own port, own systemd service, and it only APPENDS a Caddy site block.
#
# Private repo: see DEPLOY.md for the deploy-key steps, then run on the server:
#   bash /opt/tuesday-never-happened/deploy/lightsail-add.sh tnh.54-255-109-186.sslip.io git@github-tnh:tomcode1000/tuesday-never-happened.git
#
# API keys are NOT handled here — you paste them into /opt/tuesday-never-happened/.env yourself afterwards.
set -euo pipefail
DOMAIN="${1:?usage: bash lightsail-add.sh <domain> <git-repo-url>}"
REPO="${2:?usage: bash lightsail-add.sh <domain> <git-repo-url>}"
APP=/opt/tuesday-never-happened
PORT=5177
SERVICE=tnh

command -v caddy >/dev/null || { echo "Caddy isn't installed — this script expects the Detour-style server."; exit 1; }
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# refuse to steal a port another app is using
if ss -ltn | grep -q ":$PORT " && ! systemctl is-active --quiet "$SERVICE"; then
  echo "Port $PORT is already used by another app. Pick another: edit PORT in this script and in $APP/.env"; exit 1
fi

if [ ! -d "$APP/.git" ]; then
  # clone as the current user (not root) so the user's GitHub deploy key is used for the private repo
  sudo mkdir -p "$APP" && sudo chown "$USER":"$USER" "$APP"
  git clone "$REPO" "$APP"
fi

if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<ENV
DEEPSEEK_API_KEY=
FISH_AUDIO_API_KEY=
PORT=$PORT
ENV
fi
chmod 600 "$APP/.env"

sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=Tuesday Never Happened (game)
After=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

# APPEND a site block (back up first). Existing sites stay exactly as they are.
if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  sudo tee -a /etc/caddy/Caddyfile >/dev/null <<CADDY

$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
CADDY
fi
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sudo systemctl reload caddy

echo
echo "Installed. Next:"
echo "  1) nano $APP/.env      # paste DEEPSEEK_API_KEY and FISH_AUDIO_API_KEY, save"
echo "  2) sudo systemctl restart $SERVICE"
echo "  3) open https://$DOMAIN"
