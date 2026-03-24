#!/bin/bash
# Deploy ReconAI Financial Hub to VPS
# Usage: bash deploy.sh <user>@<ip>
# Example: bash deploy.sh root@76.13.52.26

set -e

if [ -z "$1" ]; then
  echo "Usage: bash deploy.sh <user>@<host>"
  echo "Example: bash deploy.sh root@76.13.52.26"
  exit 1
fi

VPS="$1"
APP_DIR="/opt/reconai-financial-hub"

echo "==> Deploying ReconAI Financial Hub to $VPS"

# 1. Ensure Docker is installed on VPS
echo "==> Checking Docker on VPS..."
ssh "$VPS" '
  if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  fi
  echo "Docker version: $(docker --version)"
'

# 2. Sync project files to VPS
echo "==> Syncing files to VPS..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  ./ "$VPS:$APP_DIR/"

# 3. Build and start on VPS
echo "==> Building and starting container..."
ssh "$VPS" "
  cd $APP_DIR
  docker compose down 2>/dev/null || true
  docker compose up -d --build
  echo ''
  echo '==> Deployment complete!'
  echo '==> App is running at: http://\$(hostname -I | awk \"{print \\\$1}\"):3000'
"
