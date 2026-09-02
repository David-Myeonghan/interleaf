#!/usr/bin/env bash
# gh's credential helper keys on the host, not the path, so a company account
# left active on github.com wins over the URL's username and the push 403s.
# Switch, push, switch back.
set -euo pipefail
PERSONAL="David-Myeonghan"
previous="$(gh api user -q .login)"
restore() { [ "$previous" != "$PERSONAL" ] && gh auth switch -u "$previous" >/dev/null 2>&1 || true; }
trap restore EXIT
gh auth switch -u "$PERSONAL" >/dev/null 2>&1
git push "$@"
