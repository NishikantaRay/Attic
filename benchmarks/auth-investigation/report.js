#!/usr/bin/env node
'use strict';
/**
 * Print the comparison table from both arms' results.json.
 * Reports what was measured; correctness is scored by hand against the rubric.
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

function load(arm) {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, arm, 'results.json'), 'utf8')); }
  catch (e) { return null; }
}
const b = load('baseline'), a = load('attic');
if (!b || !a) { process.stderr.write('run both arms first\n'); process.exit(1); }

const n = (x) => x.toLocaleString();
const pct = (x, y) => (x === 0 ? '—' : `${(100 * (y - x) / x).toFixed(1)}%`);
const rd = (r) => Object.values(r.rediscovery || {}).reduce((s, v) => s + v.length, 0);

const rows = [
  ['Total input tokens', n(b.totals.input), n(a.totals.input), pct(b.totals.input, a.totals.input)],
  ['Total output tokens', n(b.totals.output), n(a.totals.output), pct(b.totals.output, a.totals.output)],
  ['Tool calls', n(b.totals.tools), n(a.totals.tools), pct(b.totals.tools, a.totals.tools)],
  ['Time (s)', (b.totals.wallMs / 1000).toFixed(0), (a.totals.wallMs / 1000).toFixed(0), pct(b.totals.wallMs, a.totals.wallMs)],
  ['Rediscovery (re-read files)', n(rd(b)), n(rd(a)), pct(rd(b), rd(a))],
  ['Cost (USD)', b.totals.cost.toFixed(2), a.totals.cost.toFixed(2), pct(b.totals.cost, a.totals.cost)],
];

const w = [28, 12, 12, 10];
const line = (c) => '| ' + c.map((x, i) => String(x).padEnd(w[i])).join(' | ') + ' |';
console.log(`\nAttic benchmark — authentication investigation`);
console.log(`${b.date.slice(0, 10)} · repo ${path.basename(b.repo)}\n`);
console.log(line(['Metric', 'No Attic', 'Attic', 'Δ']));
console.log('|' + w.map((x) => '-'.repeat(x + 2)).join('|') + '|');
for (const r of rows) console.log(line(r));

console.log('\nPer session (input tokens / tool calls):');
for (const s of [0, 1, 2]) {
  const bs = b.sessions[s] || {}, as = a.sessions[s] || {};
  console.log(`  session ${s + 1}:  baseline ${n(bs.inputTokens || 0)} / ${bs.toolCalls || 0}` +
              `   attic ${n(as.inputTokens || 0)} / ${as.toolCalls || 0}`);
}

console.log('\nRediscovery detail — files session 1 read that a later session read again:');
for (const [arm, r] of [['baseline', b], ['attic', a]]) {
  for (const [k, v] of Object.entries(r.rediscovery || {})) {
    console.log(`  ${arm} ${k}: ${v.length}${v.length ? '  ' + v.slice(0, 5).join(', ') + (v.length > 5 ? ' …' : '') : ''}`);
  }
}
if (a.attic) console.log(`\nAttic stashed ${a.attic.items} item(s).`);
console.log('\nCorrectness is not scored here. Read baseline/changes.diff and');
console.log('attic/changes.diff against the rubric in README.md.\n');
