#!/bin/zsh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$REPO/scripts/run.sh"
LA="$HOME/Library/LaunchAgents"
RACE="com.botbookyoucourt.race"
FALLBACK="com.botbookyoucourt.fallback"

echo "==> repo: $REPO"
mkdir -p "$LA" "$REPO/logs"
chmod +x "$RUN"

echo "==> bun"
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
bun --version

echo "==> deps"
( cd "$REPO" && bun install --frozen-lockfile )

echo "==> .env"
if [ ! -f "$REPO/.env" ]; then
  echo "!! MISSING $REPO/.env — copy it here first." >&2
  echo "   required keys: TU_A_USERNAME/PASSWORD, TU_B_USERNAME/PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, HEALTHCHECK_URL" >&2
  exit 1
fi
chmod 600 "$REPO/.env"

echo "==> prevent sleep + auto-restart after power failure (sudo)"
sudo pmset -a sleep 0 disksleep 0 autorestart 1 powernap 0

write_plist() {
  local label=$1 hour=$2 minute=$3; shift 3
  local plist="$LA/$label.plist"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$label</string>"
    echo '  <key>ProgramArguments</key><array>'
    echo "    <string>$RUN</string>"
    for a in "$@"; do echo "    <string>$a</string>"; done
    echo '  </array>'
    echo '  <key>StartCalendarInterval</key><array>'
    for wd in 0 1 2; do
      echo "    <dict><key>Weekday</key><integer>$wd</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>"
    done
    echo '  </array>'
    echo "  <key>StandardOutPath</key><string>$REPO/logs/launchd.out.log</string>"
    echo "  <key>StandardErrorPath</key><string>$REPO/logs/launchd.err.log</string>"
    echo '  <key>RunAtLoad</key><false/>'
    echo '</dict></plist>'
  } > "$plist"
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
  echo "   loaded $label ($hour:$minute Sun,Mon,Tue)"
}

echo "==> launchd agents"
LEGACY="$LA/com.aof.bookyourcourt.plist"
if [ -f "$LEGACY" ]; then
  launchctl unload -w "$LEGACY" 2>/dev/null || true
  rm -f "$LEGACY"
  echo "   removed legacy com.aof.bookyourcourt (collided with race at 06:55)"
fi
write_plist "$RACE"     6 55 run
write_plist "$FALLBACK" 7 10 run --now

echo "==> verify"
launchctl list | grep botbookyoucourt || true
echo "==> auth smoke test (hits TU API from this machine)"
( cd "$REPO" && bun src/index.ts status ) || echo "!! status failed — check .env creds / network"

echo "==> done. race Sun,Mon,Tue 06:55 | fallback Sun,Mon,Tue 07:10"
