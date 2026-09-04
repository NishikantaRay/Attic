#!/usr/bin/env bash
# publish-release.sh — tag the current commit and publish a GitHub release.
#
#   gh auth login                       # once, needs a browser
#   sh scripts/publish-release.sh       # uses the version in plugin.json
#   sh scripts/publish-release.sh 1.3.0
#
# Refuses to run on a dirty tree or an unpushed commit, so the tag always
# points at what is actually on GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH"

command -v gh >/dev/null || { echo "gh is not installed: brew install gh" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "not logged in: run 'gh auth login' first" >&2; exit 1; }

VERSION=${1:-$(node -p "require('./.claude-plugin/plugin.json').version")}
TAG="v$VERSION"

[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty; commit first" >&2; exit 1; }
git fetch -q origin
if [ -n "$(git log "origin/$(git branch --show-current)..HEAD" --oneline)" ]; then
  echo "you have unpushed commits; run: git push" >&2; exit 1
fi
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG already exists" >&2; exit 1
fi

NOTES=$(mktemp); trap 'rm -f "$NOTES"' EXIT
if [ -f docs/RELEASE-NOTES.md ]; then
  cp docs/RELEASE-NOTES.md "$NOTES"
else
  printf 'See CHANGELOG.md for what changed in %s.\n' "$VERSION" > "$NOTES"
fi

echo "Tagging $TAG and publishing..."
git tag -a "$TAG" -m "Attic $VERSION"
git push origin "$TAG"
gh release create "$TAG" --title "Attic $VERSION" --notes-file "$NOTES" --verify-tag
gh release view "$TAG" --web >/dev/null 2>&1 || true
echo "Published: $(gh release view "$TAG" --json url -q .url)"
