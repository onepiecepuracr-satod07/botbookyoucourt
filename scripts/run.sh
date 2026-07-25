#!/bin/zsh
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

HC="$(grep -E '^HEALTHCHECK_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r"' )"
ping_hc() { [ -n "$HC" ] && curl -fsS -m 10 "$HC$1" >/dev/null 2>&1 || true; }

ping_hc /start
bun src/index.ts "$@"
code=$?
[ "$code" -eq 0 ] && ping_hc "" || ping_hc "/$code"
exit "$code"
