'use strict';
// The eval suites are data. If they rot, the measurement layer is lying.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EVALS = path.join(__dirname, '..', 'skills', 'attic', 'evals');
const SKILLS = path.join(__dirname, '..', 'skills');

const skillNames = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')));

test('activation suite is well formed and references real skills', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(EVALS, 'activation.json'), 'utf8'));
  const ids = new Set();
  for (const c of suite.cases) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.prompt, 'string');
    assert.equal(typeof c.should_activate, 'boolean');
    assert.ok('expected_skill' in c, `${c.id} needs expected_skill (null when it should not activate)`);
    if (c.should_activate) assert.ok(skillNames.includes(c.expected_skill), `${c.id} expects unknown skill ${c.expected_skill}`);
    else assert.equal(c.expected_skill, null, `${c.id} should_activate=false must have expected_skill null`);
    assert.ok(c.rationale, `${c.id} needs a rationale`);
  }
  assert.ok(suite.cases.some((c) => c.should_activate), 'suite needs positive cases');
  assert.ok(suite.cases.filter((c) => !c.should_activate).length >= 5, 'suite needs negative cases to measure false positives');
});

test('behavior suite covers every level and names its checks', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(EVALS, 'behavior.json'), 'utf8'));
  const levels = new Set(suite.cases.map((c) => c.level));
  for (const l of ['lite', 'full', 'ultra', 'off']) assert.ok(levels.has(l), `no behaviour case for level ${l}`);
  for (const c of suite.cases) {
    assert.ok(c.scenario, `${c.id} needs a scenario`);
    assert.ok(Array.isArray(c.required_behaviors) && c.required_behaviors.length, `${c.id} needs required_behaviors`);
    assert.ok(Array.isArray(c.forbidden_behaviors), `${c.id} needs forbidden_behaviors (may be empty)`);
  }
});

test('every skill declares a version and a description', () => {
  for (const name of skillNames) {
    const raw = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${name}: no frontmatter`);
    assert.match(fm[1], /\nversion: \d+\.\d+\.\d+/, `${name}: needs a semver version`);
    assert.match(fm[1], /description:/, `${name}: needs a description`);
  }
});

test('plugin version matches the core skill version', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  const core = fs.readFileSync(path.join(SKILLS, 'attic', 'SKILL.md'), 'utf8').match(/\nversion: ([\d.]+)/)[1];
  assert.equal(plugin.version, core, 'plugin.json version and skills/attic version must move together');
});
