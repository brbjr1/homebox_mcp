#!/bin/bash
# Rebuild the image from this checkout and recreate the container. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t homebox-mcp:latest .
docker stop homebox-mcp 2>/dev/null || true
docker rm homebox-mcp 2>/dev/null || true
docker run -d \
  --name homebox-mcp \
  --restart unless-stopped \
  --env-file ./.env \
  -p 8765:8765 \
  homebox-mcp:latest
