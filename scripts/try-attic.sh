#!/usr/bin/env bash
# try-attic.sh — see the difference, side by side, on your own machine.
#
# Builds a throwaway project with a real bug buried in noise files, then asks
# the same question twice: once with no attic, once with the answer stashed.
# Prints both answers and both token counts.
#
#   sh scripts/try-attic.sh              # Claude Code
#   sh scripts/try-attic.sh --host codex # Codex CLI
#
# Nothing outside the temp directory is touched.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
HOST=claude
[ "${1:-}" = "--host" ] && HOST=${2:-claude}

find_claude() {
  command -v claude 2>/dev/null && return
  ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src"
# noise, so finding the answer costs real reading
for i in $(seq 1 25); do
  { for j in $(seq 1 40); do echo "export function helper${i}_${j}(x: number) { return x * ${j}; }"; done; } > "$WORK/src/module$i.ts"
done
cat > "$WORK/src/cache.ts" <<'TS'
const store = new Map<string, {v: string, at: number}>();

export function get(k: string) {
  // BUG: no TTL check, entries are served forever once written
  return store.get(k)?.v;
}

export function set(k: string, v: string) {
  store.set(k, { v, at: Date.now() });
}
TS

Q='Why does the cache serve stale data? Answer in one sentence naming the file and the cause.'

echo
echo "════════════════════════════════════════════════════════════════"
echo " Same question, same code, two runs. Host: $HOST"
echo "════════════════════════════════════════════════════════════════"
echo
echo "  Question: $Q"
echo "  Fixture:  26 files; the answer is in exactly one of them."
echo

run_claude() { # $1 = attic on/off
  local bin; bin=$(find_claude)
  [ -n "$bin" ] || { echo "claude not found" >&2; exit 1; }
  if [ "$1" = "on" ]; then
    (cd "$WORK" && "$bin" --plugin-dir "$ROOT" -p "$Q" --output-format json --max-turns 12 --permission-mode acceptEdits </dev/null 2>/dev/null)
  else
    (cd "$WORK" && ATTIC_DEFAULT_MODE=off "$bin" -p "$Q" --output-format json --max-turns 12 --permission-mode acceptEdits </dev/null 2>/dev/null)
  fi
}
run_codex() {
  local prompt="$Q"
  # A clean baseline: if the attic plugin is installed, its skills are listed
  # to the model even when no rules are injected, so the "without" arm must
  # disable it. -c is per-invocation and changes nothing on disk.
  local off_flags=""
  if [ "$1" != "on" ]; then
    off_flags='-c plugins."attic@attic".enabled=false'
  fi
  if [ "$1" = "on" ]; then
    prompt="$(node -e '
      const rt = require(process.argv[1] + "/hooks/attic-runtime.js");
      const idx = rt.loadIndex(process.argv[2]);
      const parts = [rt.rulesFor("full")];
      if (idx) parts.push("Current attic index (.attic/INDEX.md):\n" + idx.text);
      process.stdout.write(parts.join("\n\n"));
    ' "$ROOT" "$WORK")

$Q"
  fi
  # shellcheck disable=SC2086
  (cd "$WORK" && codex exec --json --skip-git-repo-check -s workspace-write $off_flags "$prompt" </dev/null 2>/dev/null)
}

report() { # $1 = label, $2 = raw output
  if [ "$HOST" = codex ]; then
    node -e '
      const lines = process.argv[1].split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      const done = lines.filter(l => l.type === "turn.completed").pop() || { usage: {} };
      const msgs = lines.filter(l => l.type === "item.completed" && l.item && l.item.type === "agent_message");
      const cmds = lines.filter(l => l.type === "item.completed" && l.item && l.item.type === "command_execution");
      const last = msgs.length ? msgs[msgs.length - 1].item.text : "";
      console.log("  answer : " + (last.replace(/\s+/g, " ").slice(0, 200) || "(none)"));
      console.log("  input  : " + (done.usage.input_tokens || 0).toLocaleString() + " tokens");
      console.log("  looked : " + cmds.length + " shell command(s) to find it");
    ' "$2"
  else
    node -e '
      let p = {}; try { p = JSON.parse(process.argv[1]); } catch (e) {}
      const u = p.usage || {};
      const inp = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      console.log("  answer : " + String(p.result || "(none)").replace(/\s+/g, " ").slice(0, 200));
      console.log("  input  : " + inp.toLocaleString() + " tokens");
      console.log("  turns  : " + (p.num_turns || 0));
    ' "$2"
  fi
}

echo "── 1. WITHOUT attic ───────────────────────────────────────────"
echo "   (nothing stashed; the agent must read the repo)"
if [ "$HOST" = codex ]; then OUT_OFF=$(run_codex off); else OUT_OFF=$(run_claude off); fi
report "off" "$OUT_OFF"

echo
echo "── stashing the finding ───────────────────────────────────────"
node "$ROOT/skills/attic/scripts/attic.js" stash --cwd "$WORK" \
  --slug cache-no-ttl --kind finding --title "Cache serves stale entries forever" \
  --hook "src/cache.ts get() never checks the stored at timestamp, so there is no TTL" \
  --body "src/cache.ts get() returns store.get(k)?.v without comparing the stored \`at\` timestamp against any TTL. Entries written once are served forever. Fix: compare Date.now() - at against a max age and evict." | sed 's/^/  /'
echo "  .attic/ now holds 1 item and a 1-line index."

echo
echo "── 2. WITH attic ──────────────────────────────────────────────"
echo "   (same question; the answer is already in context)"
if [ "$HOST" = codex ]; then OUT_ON=$(run_codex on); else OUT_ON=$(run_claude on); fi
report "on" "$OUT_ON"

echo
echo "════════════════════════════════════════════════════════════════"
echo " Both answers should be correct. The second one costs less,"
echo " because the agent did not have to go looking."
echo
echo " This is one question. The real gain is a finding surviving"
echo " /compact and still being there tomorrow."
echo "════════════════════════════════════════════════════════════════"
