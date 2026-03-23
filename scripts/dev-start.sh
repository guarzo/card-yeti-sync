#!/usr/bin/env bash
set -euo pipefail

# Start local Postgres via Docker Compose, run migrations, then start Shopify dev.
# Usage: npm run dev:full

echo "Starting local Postgres..."
docker compose up -d --wait

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting Shopify dev server..."
shopify app dev
