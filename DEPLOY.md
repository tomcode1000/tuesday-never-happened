# Deploy to the existing Lightsail server (alongside Detour)

Target: **https://tuesday-never-happened.54-255-109-186.sslip.io**
Own folder (`/opt/tuesday-never-happened`), own port (5177), own service (`tnh`); a Caddy site block is appended (backup made first). Other apps untouched.

Open Lightsail → your instance → **Connect using SSH**, then paste:

## 1 · Install
```bash
sudo mkdir -p /opt/tuesday-never-happened && sudo chown "$USER":"$USER" /opt/tuesday-never-happened
git clone https://github.com/tomcode1000/tuesday-never-happened.git /opt/tuesday-never-happened
bash /opt/tuesday-never-happened/deploy/lightsail-add.sh tuesday-never-happened.54-255-109-186.sslip.io https://github.com/tomcode1000/tuesday-never-happened.git
```

## 2 · Add your API keys (on the server — never in chat)
```bash
nano /opt/tuesday-never-happened/.env
```
Fill `DEEPSEEK_API_KEY=` and `FISH_AUDIO_API_KEY=` → **Ctrl+O, Enter, Ctrl+X**. Then:
```bash
sudo systemctl restart tnh
curl -s localhost:5177/api/health
```
Expect `"key":true` and `"tts":true`. Open **https://tuesday-never-happened.54-255-109-186.sslip.io** (first visit may take ~30 s while the HTTPS certificate is issued).

## Updating later
```bash
bash /opt/tuesday-never-happened/deploy/update.sh
```

## If something's off
- `sudo journalctl -u tnh -n 50 --no-pager` — game server logs
- `sudo journalctl -u caddy -n 50 --no-pager` — HTTPS / certificate logs
- Caddyfile backup: `/etc/caddy/Caddyfile.bak.<timestamp>`
