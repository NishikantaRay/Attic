#!/usr/bin/env node
'use strict';
/**
 * bump-version.js — move every version string together.
 *
 * The version lives in the Claude manifest, package.json and the frontmatter
 * of every skill; the Codex manifest is generated from the Claude one. A test
 * fails if these drift, so this is the only sanctioned way to change them.
 *
 * Usage: node scripts/bump-version.js <x.y.z>
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  process.stderr.write('usage: bump-version.js <x.y.z>\n');
  process.exit(1);
}

const touched = [];
for (const f of ['.claude-plugin/plugin.json', 'package.json']) {
  const p = path.join(ROOT, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.version !== v) { j.version = v; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); touched.push(f); }
}
const skills = path.join(ROOT, 'skills');
for (const d of fs.readdirSync(skills)) {
  const p = path.join(skills, d, 'SKILL.md');
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  const out = s.replace(/^version: \d+\.\d+\.\d+$/m, `version: ${v}`);
  if (out !== s) { fs.writeFileSync(p, out); touched.push(`skills/${d}/SKILL.md`); }
}
const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-codex.js')], { encoding: 'utf8' });
if (build.status !== 0) { process.stderr.write(build.stderr); process.exit(1); }

console.log(`version ${v}: ${touched.length} file(s) updated, codex/ regenerated`);
console.log('remember: add a CHANGELOG entry, then reinstall the plugins to verify.');
