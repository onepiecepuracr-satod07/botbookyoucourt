#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_TLS_REJECT_UNAUTHORIZED=0
exec bun src/index.ts run
