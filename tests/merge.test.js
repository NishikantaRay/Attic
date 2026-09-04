'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeIndex, mergeDecisions } = require('../scripts/attic-merge.js');

test('index merge keeps both sides', () => {
  const ours = '# Attic index\n\n- [base](items/base.md) · finding · b\n- [mine](items/mine.md) · finding · m\n';
  const theirs = '# Attic index\n\n- [base](items/base.md) · finding · b\n- [yours](items/yours.md) · finding · y\n';
  const out = mergeIndex(ours, theirs);
  assert.match(out, /mine/);
  assert.match(out, /yours/);
  assert.doesNotMatch(out, /<<<</);
  assert.equal(out.split('\n').filter((l) => l.includes('base')).length, 1, 'shared line must not duplicate');
});

test('index merge dedupes by slug, later side wins', () => {
  const ours = '- [x](items/x.md) · finding · old hook\n';
  const theirs = '- [x](items/x.md) · finding · new hook\n';
  const out = mergeIndex(ours, theirs);
  assert.equal(out.split('\n').filter((l) => l.includes('[x]')).length, 1);
  assert.match(out, /new hook/);
});

test('index merge ignores non-index lines', () => {
  const out = mergeIndex('garbage\n- [a](items/a.md) · note · h\n', 'more garbage\n');
  assert.match(out, /^# Attic index/);
  assert.doesNotMatch(out, /garbage/);
});

test('decisions merge unions, dedupes and sorts chronologically', () => {
  const ours = '# Decisions\n\n- 2026-01-02 · B · because b\n';
  const theirs = '# Decisions\n\n- 2026-01-01 · A · because a\n- 2026-01-02 · B · because b\n';
  const out = mergeDecisions(ours, theirs);
  const lines = out.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 2, 'duplicate decision must collapse');
  assert.match(lines[0], /2026-01-01/, 'oldest first');
});

test('empty sides merge safely', () => {
  assert.match(mergeIndex('', ''), /^# Attic index/);
  assert.match(mergeDecisions('', ''), /^# Decisions/);
});
