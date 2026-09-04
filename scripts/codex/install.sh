#!/usr/bin/env sh
# Install Attic for Codex CLI.
#   sh codex/install.sh              install to $CODEX_HOME (default ~/.codex)
#   sh codex/install.sh --repo       install into ./.agents/skills for this repo
#   sh codex/install.sh --hooks-only register only the user-level hooks (for
#                                    users who installed the skills via
#                                    `codex plugin add attic@attic`)
#   sh codex/install.sh --uninstall  remove it
set -e

SRC=$(cd "$(dirname "$0")" && pwd -P)
CODEX_HOME=${CODEX_HOME:-$HOME/.codex}
MODE=${1:-}

case "$MODE" in
  --repo)       DEST="$PWD/.agents"; BIN="$PWD/.agents/bin" ;;
  --hooks-only) DEST="$CODEX_HOME"; BIN="$HOME/.local/bin" ;;
  --uninstall)  DEST="$CODEX_HOME"; BIN="$HOME/.local/bin" ;;
  *)            DEST="$CODEX_HOME"; BIN="$HOME/.local/bin" ;;
esac

if [ "$MODE" = "--uninstall" ]; then
  rm -rf "$DEST/skills/attic" "$DEST"/skills/attic-* "$DEST/hooks/attic-"*.js "$BIN/attic"
  echo "Removed Attic skills, hooks and launcher."
  echo "Your .attic/ folders are untouched. Remove the attic hooks from $DEST/hooks.json by hand."
  exit 0
fi

command -v node >/dev/null || { echo "node is required and was not found on PATH" >&2; exit 1; }

mkdir -p "$DEST/hooks" "$BIN"
cp -R "$SRC/hooks/." "$DEST/hooks/"
cp "$SRC/bin/attic" "$BIN/attic"
chmod +x "$BIN/attic"
if [ "$MODE" != "--hooks-only" ]; then
  mkdir -p "$DEST/skills" "$DEST/scripts"
  cp -R "$SRC/skills/." "$DEST/skills/"
  cp -R "$SRC/scripts/." "$DEST/scripts/"
fi

# Wire the hooks in rather than asking the user to hand-merge JSON.
# An existing hooks.json is merged, not overwritten, and backed up first.
HOOKS_TARGET="$CODEX_HOME/hooks.json"
mkdir -p "$CODEX_HOME"
if [ -f "$HOOKS_TARGET" ]; then
  cp "$HOOKS_TARGET" "$HOOKS_TARGET.bak.$(date +%Y%m%d%H%M%S)"
fi
ATTIC_HOME="$DEST" node - "$SRC/hooks/hooks.json" "$HOOKS_TARGET" "$DEST" <<'NODE'
const fs = require('fs');
const [, , srcFile, dstFile, home] = process.argv;
const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
let dst = { hooks: {} };
if (fs.existsSync(dstFile)) {
  try { dst = JSON.parse(fs.readFileSync(dstFile, 'utf8')); } catch (e) { dst = { hooks: {} }; }
}
dst.hooks = dst.hooks || {};
const resolve = (o) => JSON.parse(JSON.stringify(o).split('${ATTIC_HOME}').join(home));
let added = 0;
for (const [event, groups] of Object.entries(src.hooks)) {
  dst.hooks[event] = (dst.hooks[event] || []).filter((g) =>
    !JSON.stringify(g).includes('attic-'));   // drop our own previous entries
  for (const g of groups) { dst.hooks[event].push(resolve(g)); added++; }
}
fs.writeFileSync(dstFile, JSON.stringify(dst, null, 2) + '\n');
console.log(`  hooks    -> ${dstFile} (${added} registered)`);
NODE

# The feature flag, added only if absent so an existing config is preserved.
# TOML forbids a duplicate [features] table, so if one already exists the
# key is inserted into it rather than a second table appended.
CONFIG="$CODEX_HOME/config.toml"
if [ ! -f "$CONFIG" ]; then
  printf '[features]\nhooks = true\n' > "$CONFIG"
  FLAG_NOTE="  config   -> $CONFIG (created, hooks enabled)"
elif grep -q '^[[:space:]]*hooks[[:space:]]*=' "$CONFIG"; then
  FLAG_NOTE="  config   -> $CONFIG already sets the hooks flag; left alone"
else
  cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  if grep -q '^[[:space:]]*\[features\][[:space:]]*$' "$CONFIG"; then
    node - "$CONFIG" <<'NODE'
const fs = require('fs');
const f = process.argv[2];
const out = fs.readFileSync(f, 'utf8').replace(/^([ \t]*\[features\][ \t]*\n)/m, '$1hooks = true\n');
fs.writeFileSync(f, out);
NODE
  else
    printf '\n[features]\nhooks = true\n' >> "$CONFIG"
  fi
  FLAG_NOTE="  config   -> $CONFIG (hooks enabled, original backed up)"
fi

echo "Installed:"
[ "$MODE" != "--hooks-only" ] && echo "  skills   -> $DEST/skills/"
echo "$FLAG_NOTE"
echo "  launcher -> $BIN/attic"
echo
case ":$PATH:" in
  *":$BIN:"*) echo "$BIN is on your PATH." ;;
  *) echo "ONE step remains: add $BIN to your PATH."
     echo "  echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.zshrc" ;;
esac
echo
echo "Verify with:  attic --where && attic validate"
echo
echo "ONE-TIME TRUST STEP: Codex skips hooks it has not reviewed. Open an"
echo "interactive codex session and run /hooks to review and trust the attic"
echo "hooks. Until then the index is not injected at session start."
