#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.aof.bookyourcourt"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"

cat > "$DEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>${ROOT}/scripts/run.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>55</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${ROOT}/logs/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>${ROOT}/logs/launchd.err.log</string>
</dict>
</plist>
PLIST

chmod +x "$ROOT/scripts/run.sh"
launchctl unload "$DEST" 2>/dev/null || true
launchctl load -w "$DEST"
launchctl list | grep "$LABEL" && echo "installed: $DEST (root: $ROOT)"
