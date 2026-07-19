#!/bin/zsh
set -uo pipefail
cd "$(dirname "$0")/.."

DATE="${1:-2026-07-22}"
COURT="${2:-3}"
ACCOUNT="${3:-aof}"
HOURS=(13 14)

codes=()

cleanup() {
  [[ ${#codes[@]} -eq 0 ]] && return
  echo "--- cancelling ${#codes[@]} booking(s) ---"
  for code in "${codes[@]}"; do
    bun src/index.ts cancel --account "$ACCOUNT" --code "$code"
  done
}
trap cleanup EXIT

for h in "${HOURS[@]}"; do
  echo "--- book $DATE ${h}:00 court $COURT ($ACCOUNT) ---"
  out="$(bun src/index.ts book --date "$DATE" --hour "$h" --court "$COURT" --account "$ACCOUNT" 2>&1)"
  echo "$out"
  code="$(echo "$out" | grep -o '"bookingCode":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')"
  if [[ -z "$code" ]]; then
    echo "ABORT: no bookingCode for ${h}:00 — cancelling any prior bookings then exit" >&2
    exit 1
  fi
  codes+=("$code")
done

echo "--- verified ${#codes[@]} bookings: ${codes[*]} ---"
