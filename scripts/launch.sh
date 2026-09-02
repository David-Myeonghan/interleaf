#!/usr/bin/env bash
set -euo pipefail
ROOT="$HOME/person/snapnote"
PROFILE="$ROOT/m0/chrome-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$PROFILE"
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port=9333 \
  --load-extension="$ROOT/probe" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=DialMediaRouteProvider \
  "about:blank" \
  >"$ROOT/m0/chrome.log" 2>&1 &
echo "chrome pid=$!"
