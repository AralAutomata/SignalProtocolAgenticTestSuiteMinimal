#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASSPHRASE="${MEGA_PASSPHRASE:-alpha}"
RUN_ID="$(date +%s)"

DBA="/home/node/.mega/alice_e2e_${RUN_ID}.db"
DBB="/home/node/.mega/bob_e2e_${RUN_ID}.db"
ALICE_BUNDLE="/tmp/alice_e2e_${RUN_ID}.bundle.json"
BOB_BUNDLE="/tmp/bob_e2e_${RUN_ID}.bundle.json"
PLAINTEXT_FILE="/tmp/plain_e2e_${RUN_ID}.txt"
ENVELOPE_FILE="/tmp/msg_e2e_${RUN_ID}.json"
OUT_FILE="/tmp/out_e2e_${RUN_ID}.txt"
PLAINTEXT="hello from docker phase zero e2e"

if [[ "${SKIP_DOCKER_BUILD:-0}" != "1" ]]; then
  docker compose build cli
fi

MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli init --id alice --db "$DBA"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli bundle export --out "$ALICE_BUNDLE" --db "$DBA"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli init --id bob --db "$DBB"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli bundle export --out "$BOB_BUNDLE" --db "$DBB"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli session init --their-bundle "$BOB_BUNDLE" --db "$DBA"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli session init --their-bundle "$ALICE_BUNDLE" --db "$DBB"

printf '%s\n' "$PLAINTEXT" > "$PLAINTEXT_FILE"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli encrypt --to bob --in "$PLAINTEXT_FILE" --out "$ENVELOPE_FILE" --db "$DBA"
MEGA_PASSPHRASE="$PASSPHRASE" docker compose run --rm -v /tmp:/tmp cli decrypt --in "$ENVELOPE_FILE" --out "$OUT_FILE" --db "$DBB"

DECRYPTED="$(cat "$OUT_FILE")"
if [[ "$DECRYPTED" != "$PLAINTEXT" ]]; then
  echo "E2E failed: decrypted text mismatch."
  echo "Expected: $PLAINTEXT"
  echo "Actual:   $DECRYPTED"
  exit 1
fi

echo "Docker E2E passed."
echo "alice_db=$DBA"
echo "bob_db=$DBB"
echo "envelope=$ENVELOPE_FILE"
echo "out=$OUT_FILE"
