#!/usr/bin/env bash
# Pre-commit guard for projects that commit .attic/.
# Blocks a commit whose staged attic content is malformed or leaks a credential.
#
# Install:
#   ln -s ../../node_modules/attic/scripts/attic-precommit.sh .git/hooks/pre-commit
# or copy it to .git/hooks/pre-commit and chmod +x.
set -euo pipefail

if ! git diff --cached --name-only | grep -q '^\.attic/'; then
  exit 0
fi

ATTIC_JS="${ATTIC_JS:-$(dirname "$0")/../skills/attic/scripts/attic.js}"
if [ ! -f "$ATTIC_JS" ]; then
  echo "attic: cannot find attic.js, skipping check" >&2
  exit 0
fi

echo "attic: validating .attic/ before commit"
if ! node "$ATTIC_JS" validate; then
  echo >&2
  echo "attic: commit blocked. Fix the problems above, or run with --no-verify to override." >&2
  exit 1
fi
