#!/usr/bin/env node
'use strict';
/**
 * extract.js — one row per coding session, from transcripts you already have.
 *
 * Answers "is my setup getting better?" without instrumenting anything: the
 * data is already in ~/.claude/projects/*.jsonl, so this works retroactively
 * and gives you a baseline for free.
 *
 * The headline metric is the repeat-read rate: of all the file reads in a
 * session, what fraction were files that session had already read. Low means
 * the agent held what it learned; high means it kept going back for the same
 * thing.
 *
 * Chosen over the obvious alternatives after testing all of them against 280
 * real sessions:
 *   - user corrections   2 hits in 80 sessions. People do not type "wrong".
 *   - tool error rate    1-3% everywhere. No discrimination.
 *   - context growth     mostly restates session length.
 *   - repeat-read rate   0-64% range, -0.02 correlation with length. Real.
 *
 * Usage:
 *   node extract.js                       one row per session, newest first
 *   node extract.js --json                machine-readable
 *   node extract.js --project <substr>    filter by project path
 *   node extract.js --since 2026-09-01    only sessions after a date
 *   node extract.js --min-reads 5         skip sessions too small to score
 *   node extract.js --include-scratch     include temp dirs and benchmark runs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

function listTranscripts(root) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch (e) { return out; }
  for (const d of dirs) {
    const full = path.join(root, d);
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.jsonl')) continue;
      out.push({ project: d, file: path.join(full, f) });
    }
  }
  return out;
}

function readRows(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch (e) { /* a partial write at the tail */ }
  }
  return rows;
}

/**
 * A session's shape. Everything here is counted from what the agent actually
 * did, never from prose it wrote about what it did.
 */
function summarise(rows) {
  const usage = [];
  const reads = new Map();       // resolved path -> times opened
  const tools = {};
  let toolErrors = 0, edits = 0, compactions = 0;
  let firstTs = null, lastTs = null;

  for (const r of rows) {
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) { if (firstTs === null || t < firstTs) firstTs = t; if (lastTs === null || t > lastTs) lastTs = t; }
    }
    if (r.type === 'summary') compactions++;
    if (r.message && r.message.usage) usage.push(r.message.usage);

    const content = r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'tool_result' && part.is_error) toolErrors++;
      if (part.type !== 'tool_use') continue;
      tools[part.name] = (tools[part.name] || 0) + 1;
      const input = part.input || {};
      if (part.name === 'Edit' || part.name === 'Write' || part.name === 'NotebookEdit') edits++;
      const fp = input.file_path || input.notebook_path;
      // A tool's own bookkeeping files are not the work; counting them would
      // measure the tool using itself.
      if (fp && !fp.includes('/.attic/') && !fp.includes('/.claude/')) {
        reads.set(path.resolve(fp), (reads.get(path.resolve(fp)) || 0) + 1);
      }
    }
  }
  if (!usage.length) return null;

  const counts = [...reads.values()];
  const totalReads = counts.reduce((a, n) => a + n, 0);
  const distinct = counts.length;
  const repeat = totalReads - distinct;         // every read beyond the first
  const ctx = usage.map((u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0));

  return {
    turns: usage.length,
    inputTokens: usage.reduce((a, u) => a + (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), 0),
    outputTokens: usage.reduce((a, u) => a + (u.output_tokens || 0), 0),
    contextFirst: ctx[0],
    contextMax: Math.max(...ctx),
    toolCalls: Object.values(tools).reduce((a, n) => a + n, 0),
    toolErrors,
    edits,
    compactions,
    distinctFiles: distinct,
    totalReads,
    repeatReads: repeat,
    // The headline. Null rather than 0 when there is too little to score, so
    // "no data" never masquerades as a perfect result.
    repeatRate: totalReads >= 5 ? +(repeat / totalReads).toFixed(3) : null,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    tools,
  };
}

function projectLabel(slug) {
  // Slugs are the absolute path with / . and _ replaced by -; the tail is the
  // only readable part. Keep the whole slug as the identity so distinct
  // directories never collapse into one row — a shared label made 200
  // unrelated temp projects look like a single busy project.
  return slug.replace(/^-+/, '').split('-').slice(-3).join('-');
}

// Scratch work: temp dirs, this tool's own benchmark and test fixtures. Real
// projects live under a home directory, not /tmp or /var/folders.
const SCRATCH = /^-?private-var-folders|^-?var-folders|^-?tmp-|scratchpad|attic-bench-|bench-(attic|baseline|noAttic)-|^-?T-tmp-|beh-a\d-/;

function isScratch(slug) { return SCRATCH.test(slug); }

function collect(opts = {}) {
  const rows = [];
  for (const { project, file } of listTranscripts(opts.root || PROJECTS)) {
    if (opts.project && !project.toLowerCase().includes(opts.project.toLowerCase())) continue;
    let mtime;
    try { mtime = fs.statSync(file).mtimeMs; } catch (e) { continue; }
    if (opts.since && mtime < opts.since) continue;

    const s = summarise(readRows(file));
    if (!s) continue;
    if (opts.minReads && s.totalReads < opts.minReads) continue;
    if (!opts.includeScratch && isScratch(project)) continue;
    rows.push(Object.assign({
      project, label: projectLabel(project),
      session: path.basename(file, '.jsonl'),
      date: new Date(mtime).toISOString().slice(0, 10), mtime,
    }, s));
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
}

function render(rows) {
  if (!rows.length) return 'No sessions matched.';
  const L = [];
  const scored = rows.filter((r) => r.repeatRate !== null);

  L.push('date        turns  tools  in-tokens   files  reads  repeat   rate  project');
  for (const r of rows.slice(0, 40)) {
    const rate = r.repeatRate === null ? '   —' : (r.repeatRate * 100).toFixed(0).padStart(3) + '%';
    L.push([
      r.date,
      String(r.turns).padStart(6),
      String(r.toolCalls).padStart(6),
      String(Math.round(r.inputTokens / 1000) + 'k').padStart(10),
      String(r.distinctFiles).padStart(7),
      String(r.totalReads).padStart(6),
      String(r.repeatReads).padStart(7),
      rate.padStart(6),
      '  ' + r.label,
    ].join(''));
  }
  if (rows.length > 40) L.push(`… ${rows.length - 40} more`);

  L.push('');
  if (scored.length) {
    const rates = scored.map((r) => r.repeatRate).sort((a, b) => a - b);
    const med = rates[Math.floor(rates.length / 2)];
    L.push(`${scored.length} session(s) had enough reads to score (>=5).`);
    L.push(`Repeat-read rate: median ${(med * 100).toFixed(0)}%, range ${(rates[0] * 100).toFixed(0)}-${(rates[rates.length - 1] * 100).toFixed(0)}%.`);
    L.push('');
    L.push('Lower is better: it means the agent held what it learned instead of');
    L.push('going back for the same file. Compare a project against its own past,');
    L.push('not against another project — a monorepo and a script differ honestly.');
  } else {
    L.push('No session had >=5 file reads, so nothing could be scored.');
  }
  L.push('');
  L.push('Counted from what the agent did, not what it said. Nothing left your machine.');
  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2); const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; }
  }
  const rows = collect({
    project: typeof args.project === 'string' ? args.project : null,
    since: args.since ? Date.parse(args.since) : null,
    minReads: args['min-reads'] ? parseInt(args['min-reads'], 10) : 0,
    includeScratch: !!args['include-scratch'],
  });
  process.stdout.write((args.json ? JSON.stringify(rows, null, 2) : render(rows)) + '\n');
}

if (require.main === module) main();
module.exports = { collect, summarise, readRows, listTranscripts, projectLabel, isScratch, render };
