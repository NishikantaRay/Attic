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
