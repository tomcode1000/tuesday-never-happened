# Deploy to the existing Lightsail server (alongside Detour)

Target: **https://tnh.54-255-109-186.sslip.io** — own port (5177), own service (`tnh`), Caddy site block appended. Other apps untouched.

Open Lightsail → your instance → **Connect using SSH**, then paste each block.

## 1 · Give the server read-only access to the private repo (deploy key)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/tnh_deploy -N "" -C "lightsail-tnh"
cat >> ~/.ssh/config <<'EOF'

Host github-tnh
  HostName github.com
  User git
  IdentityFile ~/.ssh/tnh_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/tnh_deploy.pub
```
Copy the line that starts with `ssh-ed25519` (it's a **public** key — safe to share) and either paste it to Claude, or add it yourself:
GitHub → repo **tuesday-never-happened** → Settings → Deploy keys → Add deploy key → paste → *(leave "Allow write access" unticked)*.

## 2 · Clone and install
```bash
ssh -o StrictHostKeyChecking=accept-new -T github-tnh 2>&1 | head -1   # expect "successfully authenticated"
sudo mkdir -p /opt/tuesday-never-happened && sudo chown "$USER":"$USER" /opt/tuesday-never-happened
git clone git@github-tnh:tomcode1000/tuesday-never-happened.git /opt/tuesday-never-happened
bash /opt/tuesday-never-happened/deploy/lightsail-add.sh tnh.54-255-109-186.sslip.io git@github-tnh:tomcode1000/tuesday-never-happened.git
```

## 3 · Add your API keys (on the server, never in chat)
```bash
nano /opt/tuesday-never-happened/.env
```
Fill `DEEPSEEK_API_KEY=` and `FISH_AUDIO_API_KEY=` → Ctrl+O, Enter, Ctrl+X. Then:
```bash
sudo systemctl restart tnh
curl -s localhost:5177/api/health      # expect "key":true,"tts":true
```
Open **https://tnh.54-255-109-186.sslip.io** (the HTTPS certificate can take ~30 s on first visit).

## Updating later
```bash
bash /opt/tuesday-never-happened/deploy/update.sh
```

## If something's off
- `sudo journalctl -u tnh -n 50 --no-pager` — game server logs
- `sudo journalctl -u caddy -n 50 --no-pager` — HTTPS / certificate logs
- A Caddyfile backup is saved as `/etc/caddy/Caddyfile.bak.<timestamp>` before any change.
