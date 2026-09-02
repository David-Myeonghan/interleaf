#!/usr/bin/env bash
# Builds the upload zip. Only the extension directory goes in: the store
# rejects archives carrying build scripts, and reviewers read the repo for
# source anyway.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run --silent build
VERSION="$(node -p "require('./extension/manifest.json').version")"
OUT="$ROOT/dist/interleaf-$VERSION.zip"
mkdir -p "$ROOT/dist"
rm -f "$OUT"
cd "$ROOT/extension"
# Zips the manifest's own directory contents, excluding the build stamp used
# only by the verification harness.
zip -q -r -X "$OUT" . -x 'build-stamp.json' -x '.DS_Store' -x '*/.DS_Store'
cd "$ROOT"
echo "$OUT"
unzip -l "$OUT" | tail -n +4 | head -20
