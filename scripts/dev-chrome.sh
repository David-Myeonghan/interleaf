#!/usr/bin/env bash
# Chrome for Testing still honours --load-extension, which branded Chrome dropped
# in 137. Used for self-verification; the real install path stays Load Unpacked.
set -euo pipefail
ROOT="$HOME/person/snapnote"
CFT="$ROOT/.browsers/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
PROFILE="$ROOT/.dev-profile"
mkdir -p "$PROFILE"
"$CFT" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port=9444 \
  --load-extension="$ROOT/extension" \
  --no-first-run --no-default-browser-check \
  --allow-file-access-from-files \
  "about:blank" >"$ROOT/.dev-profile/chrome.log" 2>&1 &
echo "pid=$!"
