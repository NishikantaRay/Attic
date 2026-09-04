'use strict';
// Shared helpers for the attic hooks. Zero dependencies, Node >= 18.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEVELS = ['lite', 'full', 'ultra', 'off'];
const DEFAULT_LEVEL = 'full';

function stateDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'attic');
}
const modeFile = () => path.join(stateDir(), 'mode');
const configFile = () => path.join(stateDir(), 'config.json');

function normalizeMode(value) {
  const v = String(value || '').trim().toLowerCase();
  return LEVELS.includes(v) ? v : null;
}

function readConfigDefault() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return normalizeMode(cfg.defaultMode);
  } catch (e) {
    return null;
  }
}

function getDefaultMode() {
  return readConfigDefault() || normalizeMode(process.env.ATTIC_DEFAULT_MODE) || DEFAULT_LEVEL;
}

function readMode() {
  try {
    const m = normalizeMode(fs.readFileSync(modeFile(), 'utf8'));
    if (m) return m;
  } catch (e) { /* no session state yet */ }
  return getDefaultMode();
}

function setMode(mode) {
  const m = normalizeMode(mode);
  if (!m) return null;
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(modeFile(), m + '\n');
  return m;
}

function clearMode() {
  try { fs.unlinkSync(modeFile()); } catch (e) { /* already gone */ }
}

function writeDefaultMode(mode) {
  const m = normalizeMode(mode);
  if (!m) return null;
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ defaultMode: m }, null, 2) + '\n');
  return m;
}

// Read all of stdin, but never hang: resolve with '' after timeoutMs.
function readStdin(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const timer = setTimeout(finish, timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => { clearTimeout(timer); finish(); });
      process.stdin.on('error', () => { clearTimeout(timer); finish(); });
    } catch (e) {
      clearTimeout(timer);
      finish();
    }
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// Load .attic/INDEX.md from the project, capped so it never floods context.
function loadIndex(cwd, opts = {}) {
  const maxLines = opts.maxLines || 60;
  const maxBytes = opts.maxBytes || 4096;
  const file = path.join(cwd || process.cwd(), '.attic', 'INDEX.md');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const total = lines.length;
  let kept = lines.slice(0, maxLines);
  let text = kept.join('\n');
  while (Buffer.byteLength(text, 'utf8') > maxBytes && kept.length > 1) {
    kept = kept.slice(0, -1);
    text = kept.join('\n');
  }
  const hidden = total - kept.length;
  if (hidden > 0) text += `\n... ${hidden} more line(s) not shown. Run /attic-index to see everything.`;
  return { text, total, shown: kept.length };
}

const RULES = {
  common: [
    'ATTIC MODE ACTIVE. Keep the conversation lean: detail goes into .attic/, the chat holds the handle.',
    'Layout: .attic/INDEX.md (one line per item: "- [slug](items/slug.md) · kind · hook"), .attic/DECISIONS.md (append-only "- date · decision · because why"), .attic/items/<slug>.md (frontmatter title/kind/date/tags, then content). Create with mkdir -p .attic/items on first stash. Handle in chat: attic:<slug>.',
    'Inside items copy code, paths, commands and errors verbatim. Never stash secrets or credentials.',
  ],
  lite: [
    'Level: lite. Stash only when the user asks (/attic-stash), at the end of a task, or when asked to sweep. Otherwise reply normally.',
  ],
  full: [
    'Level: full. After any investigation (reading >3 files, a grep sweep, a test run) write the conclusion to items/<slug>.md, add an INDEX line, and reply with the handle plus at most three lines.',
    'Never re-explain what is already in the attic; point at the handle. Every non-trivial decision goes to DECISIONS.md with its why.',
    'Long tool output never lands in prose: summarise in <=5 lines, stash it with the exact command, reference the handle.',
    'Check INDEX.md before re-reading a file or re-running a search. Before context gets long or before /compact, sweep: stash plan, open questions and in-progress state (/attic-sweep).',
  ],
  ultra: [
    'Level: ultra. Stash every non-trivial finding immediately. Replies are the handle plus at most three lines.',
    'You MUST consult INDEX.md before any read or search of something already seen this session, and cite the item (per attic:<slug>) instead of re-reading.',
    'Every decision goes to DECISIONS.md. Long output is never pasted; summarise, stash, reference. Sweep proactively when the tool-call count grows.',
  ],
  off: [
    'Attic plugin is installed but OFF. Do not stash anything. Run /attic to turn it on.',
  ],
};

function rulesFor(mode) {
  const m = normalizeMode(mode) || DEFAULT_LEVEL;
  if (m === 'off') return RULES.off.join('\n');
  return RULES.common.concat(RULES[m]).join('\n');
}

function subagentRulesFor(mode) {
  const m = normalizeMode(mode) || DEFAULT_LEVEL;
  if (m === 'off' || m === 'lite') return null;
  return [
    'ATTIC MODE ACTIVE (subagent). Before returning, write any substantial finding to .attic/items/<slug>.md and add one line to .attic/INDEX.md ("- [slug](items/slug.md) · kind · hook"); mkdir -p .attic/items first.',
    'Your final report should be short and cite the handles (attic:<slug>) instead of repeating the detail.',
    'Copy code, paths, commands and errors verbatim inside items. Never stash secrets.',
  ].join('\n');
}

function writeHookOutput(hookEventName, additionalContext) {
  if (!additionalContext) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext },
  }) + '\n');
}

module.exports = {
  LEVELS, DEFAULT_LEVEL, stateDir, modeFile, configFile,
  normalizeMode, getDefaultMode, readMode, setMode, clearMode, writeDefaultMode,
  readStdin, parseJson, loadIndex, rulesFor, subagentRulesFor, writeHookOutput,
};
