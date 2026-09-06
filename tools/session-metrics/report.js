#!/usr/bin/env node
'use strict';
/**
 * report.js — aggregate sessions into a per-project baseline, and say whether
 * anything has actually changed.
 *
 * The hard part is not the arithmetic, it is refusing to call a trend that the
 * data cannot support. With a handful of sessions almost any movement is
 * noise, so this reports a verdict only when there is enough to earn one, and
 * says "not enough data" the rest of the time.
 *
 * Usage:
 *   node report.js                    per-project baselines
 *   node report.js --trend            add a before/after split where possible
 *   node report.js --project attic    one project
 *   node report.js --json
 */
const { collect } = require('./extract.js');

// Below this, a difference between two groups means nothing. Chosen because
// with n<4 a single unusual session moves the median by more than any real
// effect would.
const MIN_FOR_TREND = 4;
const MIN_PER_HALF = 2;

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function group(rows) {
  // Group by the full slug: two different directories can share a short
  // label, and merging them invents a project that does not exist.
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.project)) byProject.set(r.project, []);
    byProject.get(r.project).push(r);
  }

  const out = [];
  for (const [slug, all] of byProject) {
    const sessions = all.slice().sort((a, b) => a.mtime - b.mtime);
    const scored = sessions.filter((s) => s.repeatRate !== null);
    const days = [...new Set(sessions.map((s) => s.date))].sort();

    const entry = {
      project: sessions[0].label,
      slug,
      sessions: sessions.length,
      scored: scored.length,
      firstDay: days[0],
      lastDay: days[days.length - 1],
      days: days.length,
      medianRepeatRate: median(scored.map((s) => s.repeatRate)),
      medianTurns: median(sessions.map((s) => s.turns)),
      totalInputTokens: sessions.reduce((a, s) => a + s.inputTokens, 0),
      totalEdits: sessions.reduce((a, s) => a + s.edits, 0),
      trend: null,
    };

    // A before/after split, only when both halves are big enough to compare.
    if (scored.length >= MIN_FOR_TREND) {
      const half = Math.floor(scored.length / 2);
      const older = scored.slice(0, half), newer = scored.slice(scored.length - half);
      if (older.length >= MIN_PER_HALF && newer.length >= MIN_PER_HALF) {
        const a = median(older.map((s) => s.repeatRate));
        const b = median(newer.map((s) => s.repeatRate));
        entry.trend = { older: a, newer: b, delta: +(b - a).toFixed(3),
          olderN: older.length, newerN: newer.length };
      }
    }
    out.push(entry);
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

function verdict(e) {
  if (e.scored === 0) return ['no session had enough file reads to score'];
  const lines = [];
  const pct = (x) => (x * 100).toFixed(0) + '%';

  if (!e.trend) {
    lines.push(`baseline ${pct(e.medianRepeatRate)} repeat reads, from ${e.scored} scored session(s)`);
    lines.push(e.scored < MIN_FOR_TREND
      ? `not enough to call a trend — needs ${MIN_FOR_TREND} scored sessions, has ${e.scored}`
      : 'not enough on each side of the split to compare');
    return lines;
  }

  const { older, newer, delta, olderN, newerN } = e.trend;
  lines.push(`${pct(older)} → ${pct(newer)} repeat reads (oldest ${olderN} vs newest ${newerN})`);
  // A tenth is the smallest move worth naming at these sample sizes.
  if (Math.abs(delta) < 0.10) lines.push('no meaningful change; within the noise at this sample size');
  else if (delta < 0) lines.push(`IMPROVING: ${pct(-delta)} fewer repeat reads than before`);
  else lines.push(`WORSENING: ${pct(delta)} more repeat reads than before`);
  if (e.days < 2) lines.push('all sessions on one day, so this is within-day variation, not a trend over time');
  return lines;
}

function render(entries, opts) {
  const L = [];
  if (!entries.length) return 'No sessions matched.';

  L.push('project                          sess  scored  days   repeat-rate   tokens');
  for (const e of entries) {
    L.push([
      e.project.slice(0, 32).padEnd(33),
      String(e.sessions).padStart(4),
      String(e.scored).padStart(8),
      String(e.days).padStart(6),
      (e.medianRepeatRate === null ? '—' : (e.medianRepeatRate * 100).toFixed(0) + '%').padStart(14),
      (Math.round(e.totalInputTokens / 1e6) + 'M').padStart(9),
    ].join(''));
  }

  L.push('');
  L.push('Per project');
  for (const e of entries) {
    L.push(`  ${e.project}  (${e.firstDay}${e.days > 1 ? ' → ' + e.lastDay : ''})`);
    for (const v of verdict(e)) L.push(`    ${v}`);
  }

  const trendable = entries.filter((e) => e.trend);
  L.push('');
  if (!trendable.length) {
    L.push('No project has enough scored sessions to show a trend yet.');
    L.push(`A trend needs ${MIN_FOR_TREND} scored sessions in one project, ideally across`);
    L.push('several days. Keep working; this reads history, so the answer arrives on its own.');
  } else {
    L.push(`${trendable.length} project(s) had enough history to compare.`);
  }
  L.push('');
  L.push('Lower repeat-read rates are better. Compare a project only against its');
  L.push('own past — a monorepo and a script differ honestly.');
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
    minReads: 0,
    includeScratch: !!args['include-scratch'],
  });
  const entries = group(rows);
  process.stdout.write((args.json ? JSON.stringify(entries, null, 2) : render(entries, args)) + '\n');
}

if (require.main === module) main();
module.exports = { group, verdict, median, MIN_FOR_TREND };
