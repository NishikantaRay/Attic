#!/usr/bin/env node
'use strict';
/**
 * attic-stats.js — what the attic costs and what it holds, measured locally.
 *
 * Reads Claude Code session transcripts (~/.claude/projects/<slug>/*.jsonl)
 * read-only, plus the project's .attic/. Nothing leaves the machine: no
 * network, no telemetry, no API calls.
 *
 * It does not invent a savings percentage. Token usage varies with the task,
 * so a single number would be dishonest. It reports what is measurable and
 * says where the attic costs more than it returns.
 *
 * Usage: node scripts/attic-stats.js [--cwd <project>] [--json] [--sessions N]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHARS_PER_TOKEN = 4; // rough, and labelled as such wherever shown

function transcriptDir(projectDir) {
  // Claude Code slugifies the project path: /Users/x/y -> -Users-x-y
  const slug = path.resolve(projectDir).replace(/[/.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

function readSessions(projectDir, limit) {
  const dir = transcriptDir(projectDir);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m).slice(0, limit || 20).map((x) => path.join(dir, x.f));
  } catch (e) { return { dir, sessions: [] }; }

  const sessions = [];
  for (const file of files) {
    let rows = [];
    try {
      rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { continue; }

    const usage = rows.filter((r) => r.message && r.message.usage).map((r) => r.message.usage);
    if (!usage.length) continue;
    const context = usage.map((u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0));
    const text = JSON.stringify(rows);
    sessions.push({
      file: path.basename(file),
      turns: usage.length,
      output: usage.reduce((a, u) => a + (u.output_tokens || 0), 0),
      contextFirst: context[0],
      contextMax: Math.max(...context),
      contextMedian: context.slice().sort((a, b) => a - b)[Math.floor(context.length / 2)],
      handleCitations: (text.match(/attic:[a-z0-9-]+/g) || []).length,
      compactions: rows.filter((r) => r.type === 'summary' || /compact/i.test(r.subtype || '')).length,
    });
  }
  return { dir, sessions };
}

function atticFacts(projectDir) {
  const root = path.join(projectDir, '.attic');
  if (!fs.existsSync(root)) return null;
  const itemsDir = path.join(root, 'items');
  const archDir = path.join(root, 'archive');
  const ls = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.md')); } catch (e) { return []; } };
  const items = ls(itemsDir);
  let pinned = 0, heldBytes = 0;
  for (const f of items) {
    const raw = fs.readFileSync(path.join(itemsDir, f), 'utf8');
    heldBytes += Buffer.byteLength(raw, 'utf8');
    if (/\npinned: true/.test(raw)) pinned++;
  }
  let decisions = 0;
  try {
    decisions = fs.readFileSync(path.join(root, 'DECISIONS.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).length;
  } catch (e) { /* none */ }

  // What the SessionStart hook actually injects.
  let injectedBytes = 0, shown = 0, total = 0, hidden = 0;
  try {
    const rt = require(path.join(__dirname, '..', 'hooks', 'attic-runtime.js'));
    const r = rt.loadIndex(projectDir);
    if (r) { injectedBytes = Buffer.byteLength(r.text, 'utf8'); shown = r.shown; total = r.total; hidden = r.hidden; }
  } catch (e) { /* runtime unavailable */ }

  return {
    items: items.length, archived: ls(archDir).length, decisions, pinned,
    heldBytes, injectedBytes,
    injectedTokensApprox: Math.round(injectedBytes / CHARS_PER_TOKEN),
    indexShown: shown, indexTotal: total, indexHidden: hidden,
  };
}

function build(projectDir, limit) {
  const { dir, sessions } = readSessions(projectDir, limit);
  const attic = atticFacts(projectDir);
  const totals = sessions.reduce((a, s) => ({
    turns: a.turns + s.turns, output: a.output + s.output,
    citations: a.citations + s.handleCitations, compactions: a.compactions + s.compactions,
  }), { turns: 0, output: 0, citations: 0, compactions: 0 });

  const verdict = [];
  if (!attic) {
    verdict.push('No .attic/ in this project. Nothing to measure yet.');
  } else {
    const perSession = attic.injectedTokensApprox;
    verdict.push(`The index costs about ${perSession} tokens at every session start (and after every compaction).`);
    if (attic.items === 0) {
      verdict.push('The attic is empty, so that cost is currently near zero and so is the benefit.');
    } else if (sessions.length && perSession > 0 && totals.citations === 0) {
      verdict.push('COSTING MORE THAN IT RETURNS: no handle was cited in the sessions read, so the index is being paid for and not used. Either the attic holds the wrong things, or the level is too low to consult it.');
    } else if (!sessions.length) {
      verdict.push('No transcripts found for this project, so the return side is unmeasured. The cost figure above is still real.');
    } else if (totals.citations > 0) {
      verdict.push(`${totals.citations} handle citation(s) across ${sessions.length} session(s): the attic is being read back, not just written.`);
    }
    if (attic.indexHidden > 0) {
      verdict.push(`${attic.indexHidden} item(s) are past the injection budget and reachable only via /attic-recall. Pin what must always be present, or prune.`);
    }
    if (attic.items < 5 && totals.turns < 40) {
      verdict.push('On a short session with a small attic, this is overhead. The return arrives on long sessions, after compaction, and in later sessions.');
    }
  }
  return { projectDir, transcriptDir: dir, sessionsRead: sessions.length, totals, attic, sessions, verdict };
}

function render(r) {
  const L = [];
  L.push(`Attic stats — ${r.projectDir}`);
  L.push('');
  if (!r.attic) {
    L.push('  no .attic/ in this project');
  } else {
    const a = r.attic;
    L.push('  Attic contents');
    L.push(`    items ${a.items}   pinned ${a.pinned}   archived ${a.archived}   decisions ${a.decisions}`);
    L.push(`    held on disk        ${(a.heldBytes / 1024).toFixed(1)} KB`);
    L.push(`    injected per session ${(a.injectedBytes / 1024).toFixed(1)} KB  (~${a.injectedTokensApprox} tokens, rough)`);
    L.push(`    index lines shown   ${a.indexShown} of ${a.indexTotal}${a.indexHidden ? `, ${a.indexHidden} collapsed` : ''}`);
  }
  L.push('');
  if (r.sessionsRead) {
    L.push(`  Sessions read: ${r.sessionsRead}`);
    L.push(`    turns ${r.totals.turns}   output tokens ${r.totals.output.toLocaleString()}`);
    L.push(`    handle citations ${r.totals.citations}   compactions ${r.totals.compactions}`);
    L.push('');
    L.push('    session            turns   ctx first    ctx max   cites');
    for (const s of r.sessions.slice(0, 8)) {
      L.push(`    ${s.file.slice(0, 8)}…  ${String(s.turns).padStart(9)}  ${String(s.contextFirst).padStart(9)}  ${String(s.contextMax).padStart(9)}  ${String(s.handleCitations).padStart(6)}`);
    }
  } else {
    L.push(`  No transcripts found under ${r.transcriptDir}`);
  }
  L.push('');
  L.push('  What this means');
  for (const v of r.verdict) L.push('    - ' + v);
  L.push('');
  L.push('  Token counts from the transcripts are exact. Byte-to-token figures');
  L.push('  are approximations at 4 chars/token. Nothing here left your machine.');
  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; }
    }
  }
  const projectDir = path.resolve(args.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const r = build(projectDir, args.sessions ? parseInt(args.sessions, 10) : 20);
  process.stdout.write((args.json ? JSON.stringify(r, null, 2) : render(r)) + '\n');
}

if (require.main === module) main();
module.exports = { build, transcriptDir, atticFacts };
