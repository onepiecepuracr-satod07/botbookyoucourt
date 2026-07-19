#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec bun src/main.ts run
