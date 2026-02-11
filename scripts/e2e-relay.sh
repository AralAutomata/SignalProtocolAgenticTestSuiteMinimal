#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASSPHRASE="${MEGA_PASSPHRASE:-alpha}"
RUN_ID="$(date +%s)"

DBA="/home/node/.mega/alice_relay_${RUN_ID}.db"
DBB="/home/node/.mega/bob_relay_${RUN_ID}.db"
LISTEN_LOG="/tmp/listen_relay_${RUN_ID}.log"
EXPECTED_TEXT="hello from relay phase one"

SERVER_INTERNAL="http://relay:8080"
SERVER_HEALTH="http://localhost:8080/health"

cleanup() {
  if [[ -n "${LISTEN_PID:-}" ]]; then
    kill "${LISTEN_PID}" >/dev/null 2>&1 || true
    wait "${LISTEN_PID}" >/dev/null 2>&1 || true
  fi
  docker compose stop relay >/dev/null 2>&1 || true
  docker compose rm -f relay >/dev/null 2>&1 || true
}

trap cleanup EXIT

if [[ "${SKIP_DOCKER_BUILD:-0}" != "1" ]]; then
  docker compose build relay cli
fi

docker compose up -d relay

for _ in $(seq 1 30); do
  if curl -fsS "$SERVER_HEALTH" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli init --id alice --db "$DBA"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client register --id alice --server "$SERVER_INTERNAL"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client prekeys upload --server "$SERVER_INTERNAL" --db "$DBA"

MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli init --id bob --db "$DBB"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client register --id bob --server "$SERVER_INTERNAL"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client prekeys upload --server "$SERVER_INTERNAL" --db "$DBB"

MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client listen --id alice --server "$SERVER_INTERNAL" --db "$DBA" >"$LISTEN_LOG" 2>&1 &
LISTEN_PID=$!

printf '%s\n' "$EXPECTED_TEXT" | MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm cli client send --to alice --server "$SERVER_INTERNAL" --db "$DBB" --in -

for _ in $(seq 1 50); do
  if grep -q "$EXPECTED_TEXT" "$LISTEN_LOG"; then
    echo "Relay E2E passed."
    exit 0
  fi
  sleep 0.2
done

echo "Relay E2E failed: message not observed."
echo "Listener output:"
cat "$LISTEN_LOG"
exit 1
