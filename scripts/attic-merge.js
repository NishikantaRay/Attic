#!/usr/bin/env node
'use strict';
/**
 * attic-merge.js — git merge driver for .attic/INDEX.md and DECISIONS.md.
 *
 * Both files are append-only, so two branches that each stash something
 * conflict on every merge. The correct resolution is almost always "keep
 * both sides", which is what this does: union the lines, drop duplicates by
 * slug (or by whole line for DECISIONS.md), preserve order.
 *
 * Git calls it as:  attic-merge.js %O %A %B %P
 *   %O ancestor   %A ours (written back)   %B theirs   %P real path
 *
 * Exit 0 = merged cleanly. Exit 1 = leave a conflict for a human.
 */
const fs = require('fs');

const INDEX_LINE = /^- \[([^\]]+)\]\(items\/([^)]+)\.md\) · ([a-z]+) · (.*)$/;

function read(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
}

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

function mergeIndex(oursText, theirsText) {
  const header = '# Attic index\n\n';
  const seen = new Map(); // slug -> line, later wins
  const order = [];
  for (const text of [oursText, theirsText]) {
    for (const raw of splitLines(text)) {
      const line = raw.trim();
      const m = line.match(INDEX_LINE);
      if (!m) continue;
      const slug = m[2];
      if (!seen.has(slug)) order.push(slug);
      seen.set(slug, line);
    }
  }
  return header + order.map((s) => seen.get(s)).join('\n') + (order.length ? '\n' : '');
}

function mergeDecisions(oursText, theirsText) {
  const header = '# Decisions\n\n';
  const seen = new Set();
  const kept = [];
  for (const text of [oursText, theirsText]) {
    for (const raw of splitLines(text)) {
      const line = raw.trim();
      if (!line.startsWith('- ') || seen.has(line)) continue;
      seen.add(line);
      kept.push(line);
    }
  }
  // Decisions carry a leading date; sorting keeps the log chronological.
  kept.sort();
  return header + kept.join('\n') + (kept.length ? '\n' : '');
}

function main() {
  const [, , , ours, theirs, realPath] = process.argv;
  if (!ours || !theirs) {
    process.stderr.write('usage: attic-merge.js %O %A %B %P\n');
    process.exit(1);
  }
  const oursText = read(ours);
  const theirsText = read(theirs);
  const target = String(realPath || ours);

  let merged;
  if (/DECISIONS\.md$/.test(target)) merged = mergeDecisions(oursText, theirsText);
  else if (/INDEX\.md$/.test(target)) merged = mergeIndex(oursText, theirsText);
  else { process.exit(1); } // not ours to merge; let git conflict normally

  fs.writeFileSync(ours, merged);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { mergeIndex, mergeDecisions };
