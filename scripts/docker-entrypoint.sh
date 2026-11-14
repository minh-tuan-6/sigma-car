#!/bin/sh
# Container entrypoint for the SIGMACAR API.
# The JSON store lives on the persistent volume ($SIGMACAR_DATA_FILE). On an empty volume the backend starts
# with an EMPTY store in production (dev seeding is disabled when NODE_ENV=production).
# Set SIGMACAR_SEED_FROM_REPO=true once to copy the repository snapshot (catalog + demo accounts) instead.
# WARNING: that snapshot contains demo accounts with publicly known passwords — rotate/remove them before go-live.
set -e

if [ ! -f "$SIGMACAR_DATA_FILE" ] && [ "$SIGMACAR_SEED_FROM_REPO" = "true" ] && [ -f /app/seed/sigmacar_store.json ]; then
  mkdir -p "$(dirname "$SIGMACAR_DATA_FILE")"
  cp /app/seed/sigmacar_store.json "$SIGMACAR_DATA_FILE"
  echo "[entrypoint] Seeded $SIGMACAR_DATA_FILE from repository snapshot."
fi

exec "$@"
