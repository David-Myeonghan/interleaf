#!/usr/bin/env bash
# Everything a fresh checkout needs before anything can be run.
#
# Two things are deliberately not in the repo: node_modules, and the browser the
# verification harness drives. Branded Chrome dropped --load-extension in 137,
# so the harness needs Chrome for Testing, which is fetched here.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> dependencies"
npm install --silent

echo "==> build"
npm run --silent build

BROWSER="$(find "$ROOT/.browsers" -type f \
  \( -name 'Google Chrome for Testing' -o -name 'chrome' -o -name 'chrome.exe' \) \
  -perm -u+x 2>/dev/null | sort | tail -1 || true)"

if [ -n "${BROWSER:-}" ]; then
  echo "==> browser already present"
else
  echo "==> Chrome for Testing (about 150MB, once per machine)"
  npx --yes @puppeteer/browsers install chrome@stable --path "$ROOT/.browsers"
fi

cat <<'DONE'

Ready.

  npm run verify    the three suites, launching their own browser
  npm run shots     regenerate the store screenshots
  npm run package   build the upload zip

To use it in your own browser: chrome://extensions, developer mode on,
"Load unpacked", pick the extension/ directory, then open its details and
turn on "Allow access to file URLs" so saved files can be reopened.
DONE
