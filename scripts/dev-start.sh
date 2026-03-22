#!/usr/bin/env bash
set -euo pipefail

# Start Fly DB and app machines, proxy the DB, then run shopify app dev.
# Usage: npm run dev:full

echo "Starting Fly Postgres (card-yeti-sync-db)..."
DB_MACHINE=$(fly machines list -a card-yeti-sync-db --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(data[0]?.id ?? '');
")
if [ -z "$DB_MACHINE" ]; then
  echo "Error: No DB machine found for card-yeti-sync-db"
  exit 1
fi

DB_STATE=$(fly machines list -a card-yeti-sync-db --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(data[0]?.state ?? '');
")
if [ "$DB_STATE" != "started" ]; then
  fly machines start "$DB_MACHINE" -a card-yeti-sync-db
  echo "Waiting for DB to be ready..."
  sleep 5
else
  echo "DB already running."
fi

echo "Starting Fly app (card-yeti-sync)..."
APP_MACHINE=$(fly machines list -a card-yeti-sync --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(data[0]?.id ?? '');
")
if [ -z "$APP_MACHINE" ]; then
  echo "Error: No app machine found for card-yeti-sync"
  exit 1
fi

APP_STATE=$(fly machines list -a card-yeti-sync --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(data[0]?.state ?? '');
")
if [ "$APP_STATE" != "started" ]; then
  fly machines start "$APP_MACHINE" -a card-yeti-sync
else
  echo "App already running."
fi

echo "Starting DB proxy (localhost:15432 -> card-yeti-sync-db:5432)..."
fly proxy 15432:5432 -a card-yeti-sync-db &
PROXY_PID=$!

# Give the proxy a moment to bind
sleep 2

echo "Starting Shopify dev server..."
shopify app dev

# Cleanup proxy on exit
kill "$PROXY_PID" 2>/dev/null || true
