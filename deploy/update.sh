#!/usr/bin/env bash
# Pull the latest game from GitHub and restart it. Run on the server: bash /opt/tuesday-never-happened/deploy/update.sh
set -euo pipefail
cd /opt/tuesday-never-happened
git pull --ff-only
sudo systemctl restart tnh
sudo systemctl --no-pager status tnh | head -n 5
