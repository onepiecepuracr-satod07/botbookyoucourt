#!/bin/zsh
set -uo pipefail
cd "$(dirname "$0")/.."
U="$(id -u)"

echo "==> loaded agents"
launchctl list | grep botbookyoucourt || echo "!! no agents loaded — run setup-macmini.sh first"

echo
echo "==> agent state / next fire"
for l in com.botbookyoucourt.race com.botbookyoucourt.fallback; do
  echo "  $l:"
  launchctl print "gui/$U/$l" 2>/dev/null | grep -iE 'state =|next fire|runs =' | sed 's/^/    /' || true
done

if [ "${1:-}" = "--live" ]; then
  echo
  echo "!! LIVE: firing fallback agent NOW via launchctl (path = run --now)."
  echo "!! If today+6 is Sat/Sun this attempts a REAL booking."
  launchctl kickstart -k "gui/$U/com.botbookyoucourt.fallback"
  sleep 4
  echo "==> tail launchd logs"
  tail -n 30 logs/launchd.out.log logs/launchd.err.log 2>/dev/null || true
else
  echo
  echo "==> safe dry-run through wrapper (no booking; tests PATH/env + auth + API + healthcheck ping)"
  zsh scripts/run.sh dry-run
  echo
  echo "tip: 'zsh scripts/test-schedule.sh --live' fires the fallback launchd agent for real."
fi
