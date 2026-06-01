#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

echo "[1/4] Pull base images"
docker compose -f docker-compose.prod.yml pull redis livekit egress || true

echo "[2/4] Build app images"
docker compose -f docker-compose.prod.yml build web server

echo "[3/4] Start or update stack"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "[4/4] Status"
docker compose -f docker-compose.prod.yml ps

echo "Done. Open: http://<server-ip>:${WEB_PORT:-8080}"
