#!/bin/zsh
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p state
LOCK="$PWD/state/.run.lock"
acquire_lock() {
  mkdir "$LOCK" 2>/dev/null && return 0
  local oldpid; oldpid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null && return 1
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || return 1
}
if ! acquire_lock; then
  echo "another instance running (pid $(cat "$LOCK/pid" 2>/dev/null)); skipping" >&2
  exit 0
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

HC="$(grep -E '^HEALTHCHECK_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r"' )"
ping_hc() { [ -n "$HC" ] && curl -fsS -m 10 "$HC$1" >/dev/null 2>&1 || true; }

ping_hc /start
bun src/index.ts "$@"
code=$?
[ "$code" -eq 0 ] && ping_hc "" || ping_hc "/$code"
exit "$code"
