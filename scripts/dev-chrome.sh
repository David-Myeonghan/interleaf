#!/usr/bin/env bash
# Chrome for Testing still honours --load-extension, which branded Chrome dropped
# in 137. Used for self-verification; the real install path stays Load unpacked.
#
# Killing by profile path and waiting for the port matters: launching while an
# instance already holds the profile does not start a new browser, it opens a
# window in the old one - which goes on running the extension bytes it loaded at
# its own start. Verifications ran against stale code that way.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFT="$ROOT/.browsers/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
PROFILE="$ROOT/.dev-profile"
PORT=9444

# Matched against the browser binary, not just the profile flag: this script's
# own command line contains the profile path too, so a bare pattern makes pgrep
# find this shell and the wait below never ends.
BROWSER_PATTERN="Google Chrome for Testing.*user-data-dir=$PROFILE"
holders() { pgrep -f "$BROWSER_PATTERN" 2>/dev/null | grep -v "^$$\$" || true; }

for pid in $(holders); do kill "$pid" 2>/dev/null || true; done
for _ in $(seq 1 40); do
  [ -z "$(holders)" ] && break
  sleep 0.25
done
for pid in $(holders); do kill -9 "$pid" 2>/dev/null || true; done
sleep 0.5
if [ -n "$(holders)" ]; then
  echo "a browser still holds $PROFILE; refusing to launch into it" >&2
  exit 1
fi
for _ in $(seq 1 40); do
  curl -s --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || break
  sleep 0.25
done

mkdir -p "$PROFILE"
"$CFT" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port=$PORT \
  --load-extension="$ROOT/extension" \
  --no-first-run --no-default-browser-check \
  --allow-file-access-from-files \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-features=CalculateNativeWinOcclusion \
  "about:blank" >"$PROFILE/chrome.log" 2>&1 &
echo "pid=$!"
