'use strict';
// Shared helpers for the attic hooks. Zero dependencies, Node >= 18.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEVELS = ['lite', 'full', 'ultra', 'off'];
const DEFAULT_LEVEL = 'full';

// Host-agnostic state location. Claude Code and Codex expose different
// variables for "somewhere this plugin may keep data"; fall back to a plain
// dotdir so any other host still works.
function stateDir() {
  return process.env.ATTIC_STATE_DIR
    || process.env.CLAUDE_PLUGIN_DATA
    || process.env.CODEX_PLUGIN_DATA
    || (process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'attic') : null)
    || path.join(os.homedir(), '.attic-state');
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

const INDEX_LINE_RE = /^- \[([^\]]+)\]\(items\/([^)]+)\.md\) · ([a-z]+) · (.*)$/;

function parseIndexLine(line) {
  const m = String(line).trim().match(INDEX_LINE_RE);
  return m ? { raw: line.trim(), slug: m[2], kind: m[3], hook: m[4] } : null;
}

// Which items are pinned? Pinned items are never trimmed out of the index.
function readPinned(cwd) {
  const dir = path.join(cwd || process.cwd(), '.attic', 'items');
  const pinned = new Set();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch (e) { return pinned; }
  for (const f of files) {
    try {
      // Only the frontmatter matters; read the head of the file.
      const fd = fs.openSync(path.join(dir, f), 'r');
      const buf = Buffer.alloc(512);
      const n = fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      if (/\npinned: true/.test(buf.slice(0, n).toString('utf8'))) pinned.add(f.replace(/\.md$/, ''));
    } catch (e) { /* unreadable item, treat as unpinned */ }
  }
  return pinned;
}

// Collapse the items that did not fit into one discoverable summary line, so
// the model knows older knowledge exists and can recall it by topic.
function summariseRest(rest) {
  if (!rest.length) return null;
  const byKind = {};
  for (const e of rest) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const parts = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => `${k}(${n})`);
  return `+ ${rest.length} older item(s) not shown: ${parts.join(' ')} — use /attic-recall <topic> or /attic-index`;
}

/**
 * Load .attic/INDEX.md for injection, newest first, under a byte budget.
 *
 * Three tiers: pinned items always survive, then the most recent items fill
 * the remaining budget, and everything else collapses to one summary line.
 * Trimming drops the OLDEST unpinned entries, never the newest.
 */
function loadIndex(cwd, opts = {}) {
  const maxBytes = opts.maxBytes || 6144;
  const maxLines = opts.maxLines || 120;
  const file = path.join(cwd || process.cwd(), '.attic', 'INDEX.md');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }

  const entries = raw.split(/\r?\n/).map(parseIndexLine).filter(Boolean);
  const total = entries.length;
  if (!total) return { text: '', total: 0, shown: 0, pinned: 0, hidden: 0 };

  const pinnedSet = opts.pinned || readPinned(cwd);
  const pinned = entries.filter((e) => pinnedSet.has(e.slug));
  const unpinned = entries.filter((e) => !pinnedSet.has(e.slug));

  // Pinned may take at most a quarter of the budget, newest pinned first.
  const pinnedBudget = Math.floor(maxBytes * 0.25);
  const keptPinned = [];
  let pinnedBytes = 0;
  for (const e of pinned.slice().reverse()) {
    const cost = Buffer.byteLength(e.raw, 'utf8') + 1;
    if (keptPinned.length && pinnedBytes + cost > pinnedBudget) break;
    keptPinned.unshift(e);
    pinnedBytes += cost;
  }

  // Recent items fill what is left, newest first. Reserve room for the block
  // headers ("Pinned:", "Recent:") and the trailing summary line so the
  // rendered text stays inside the budget.
  const OVERHEAD = 220;
  const keptRecent = [];
  let bytes = pinnedBytes + OVERHEAD;
  for (const e of unpinned.slice().reverse()) {
    const cost = Buffer.byteLength(e.raw, 'utf8') + 1;
    if (bytes + cost > maxBytes || keptPinned.length + keptRecent.length >= maxLines) break;
    keptRecent.unshift(e);
    bytes += cost;
  }

  const keptSlugs = new Set(keptPinned.concat(keptRecent).map((e) => e.slug));
  const rest = entries.filter((e) => !keptSlugs.has(e.slug));

  const blocks = [];
  if (keptPinned.length) blocks.push('Pinned:\n' + keptPinned.map((e) => e.raw).join('\n'));
  if (keptRecent.length) blocks.push((keptPinned.length ? 'Recent:\n' : '') + keptRecent.map((e) => e.raw).join('\n'));
  const summary = summariseRest(rest);
  if (summary) blocks.push(summary);

  return {
    text: blocks.join('\n\n'),
    total,
    shown: keptPinned.length + keptRecent.length,
    pinned: keptPinned.length,
    hidden: rest.length,
  };
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
  readStdin, parseJson, loadIndex, readPinned, parseIndexLine, rulesFor, subagentRulesFor, writeHookOutput,
};
