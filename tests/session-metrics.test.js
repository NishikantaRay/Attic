'use strict';
// The extractor's job is to be trustworthy about its own numbers. Every test
// here guards a way it could report something plausible but wrong.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { summarise, collect, projectLabel } = require('../tools/session-metrics/extract.js');

const use = (i = 100, o = 10) => ({ message: { usage: { input_tokens: i, output_tokens: o } }, type: 'assistant' });
const read = (p) => ({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 1 },
  content: [{ type: 'tool_use', name: 'Read', input: { file_path: p } }] } });

test('repeat reads count every open beyond the first', () => {
  const s = summarise([use(), read('/p/a.js'), read('/p/a.js'), read('/p/a.js'), read('/p/b.js'), read('/p/c.js')]);
  assert.equal(s.totalReads, 5);
  assert.equal(s.distinctFiles, 3);
  assert.equal(s.repeatReads, 2, 'a.js opened 3 times = 2 repeats');
  assert.equal(s.repeatRate, 0.4);
});

test('a session with too few reads scores null, never zero', () => {
  // 0% would read as a perfect session; null says "not enough to judge".
  const s = summarise([use(), read('/p/a.js'), read('/p/b.js')]);
  assert.equal(s.totalReads, 2);
  assert.equal(s.repeatRate, null);
});

test('the tool does not count its own bookkeeping as work', () => {
  const s = summarise([use(),
    read('/p/.attic/INDEX.md'), read('/p/.attic/INDEX.md'), read('/p/.claude/settings.json'),
    read('/p/a.js'), read('/p/a.js'), read('/p/b.js'), read('/p/c.js'), read('/p/d.js'), read('/p/e.js')]);
  assert.equal(s.totalReads, 6, '.attic/ and .claude/ reads must be excluded');
  assert.equal(s.repeatReads, 1);
});

test('a transcript with no usage rows is skipped rather than scored', () => {
  assert.equal(summarise([{ type: 'user', message: { content: [] } }]), null);
});

test('a truncated final line does not lose the whole session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-'));
  const proj = path.join(dir, '-Users-x-demo');
  fs.mkdirSync(proj, { recursive: true });
  const good = [use(), read('/p/a.js'), read('/p/a.js'), read('/p/b.js'), read('/p/c.js'), read('/p/d.js')];
  fs.writeFileSync(path.join(proj, 's.jsonl'),
    good.map((r) => JSON.stringify(r)).join('\n') + '\n{"type":"assist');  // partial write
  const rows = collect({ root: dir });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalReads, 5);
});

test('edits and errors are counted separately from reads', () => {
  const s = summarise([use(),
    { type: 'assistant', message: { usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } }]);
  assert.equal(s.edits, 1);
  assert.equal(s.toolErrors, 1);
});

test('filters narrow the set without changing the numbers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm2-'));
  for (const name of ['-Users-x-alpha', '-Users-x-beta']) {
    const p = path.join(dir, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 's.jsonl'),
      [use(), read('/p/a.js'), read('/p/a.js'), read('/p/b.js'), read('/p/c.js'), read('/p/d.js')]
        .map((r) => JSON.stringify(r)).join('\n'));
  }
  assert.equal(collect({ root: dir }).length, 2);
  const only = collect({ root: dir, project: 'alpha' });
  assert.equal(only.length, 1);
  assert.equal(only[0].totalReads, 5, 'filtering must not alter the measurement');
  assert.equal(collect({ root: dir, minReads: 99 }).length, 0);
});

test('project labels stay readable', () => {
  assert.equal(projectLabel('-Users-nishikantaray-Desktop-Personal-Attic'), 'Desktop-Personal-Attic');
});

// ---------- layer 2/3: aggregation and trend ----------

const { group, verdict, median, MIN_FOR_TREND } = require('../tools/session-metrics/report.js');
const { isScratch } = require('../tools/session-metrics/extract.js');

const sess = (slug, rate, day) => ({
  project: '-Users-x-' + slug, label: slug, repeatRate: rate,
  mtime: Date.parse('2026-09-' + String(day).padStart(2, '0')),
  date: '2026-09-' + String(day).padStart(2, '0'),
  turns: 40, inputTokens: 1e6, edits: 2,
});

test('a trend is refused until there are enough scored sessions', () => {
  for (const n of [1, 2, 3]) {
    const e = group([...Array(n)].map((_, i) => sess('demo', 0.5, i + 1)))[0];
    assert.equal(e.trend, null, `${n} session(s) must not produce a trend`);
    assert.match(verdict(e).join(' '), /not enough to call a trend/);
  }
  const ok = group([...Array(MIN_FOR_TREND)].map((_, i) => sess('demo', 0.5, i + 1)))[0];
  assert.ok(ok.trend, `${MIN_FOR_TREND} sessions should produce a trend`);
});

test('improving, worsening and flat are each named correctly', () => {
  const run = (rates) => verdict(group(rates.map((r, i) => sess('demo', r, i + 1)))[0]).join(' ');
  assert.match(run([0.6, 0.6, 0.2, 0.2]), /IMPROVING/);
  assert.match(run([0.2, 0.2, 0.6, 0.6]), /WORSENING/);
  assert.match(run([0.4, 0.4, 0.42, 0.41]), /no meaningful change/);
});

test('a small move is called noise, not a trend', () => {
  // 5 points apart, under the 10-point floor: must not be announced.
  const said = verdict(group([0.40, 0.40, 0.45, 0.45].map((r, i) => sess('demo', r, i + 1)))[0]).join(' ');
  assert.match(said, /noise/);
  assert.doesNotMatch(said, /IMPROVING|WORSENING/);
});

test('single-day history is flagged as within-day variation', () => {
  const rows = [0.6, 0.6, 0.2, 0.2].map((r) => sess('demo', r, 3));
  rows.forEach((x, i) => { x.mtime += i; });   // same day, ordered
  assert.match(verdict(group(rows)[0]).join(' '), /one day/);
});

test('projects sharing a short label are not merged', () => {
  const a = sess('alpha', 0.5, 1); a.project = '-Users-x-one-alpha';
  const b = sess('alpha', 0.5, 2); b.project = '-Users-x-two-alpha';
  assert.equal(group([a, b]).length, 2, 'different directories must stay separate');
});

test('scratch directories are recognised so they do not drown the report', () => {
  for (const s of ['-private-var-folders-cf-xyz-T-attic-bench-attic-123', '-tmp-foo',
                   '-Users-x-scratchpad-beh', 'bench-baseline-1788690544010', 'beh-a1-8iiA5z']) {
    assert.equal(isScratch(s), true, `${s} should be scratch`);
  }
  for (const s of ['-Users-nishikantaray-Desktop-Personal-Attic', '-Users-x-work-api']) {
    assert.equal(isScratch(s), false, `${s} is a real project`);
  }
});

test('median handles even and odd counts', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});
