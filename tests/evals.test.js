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

// ---------- regressions found by a real plugin install ----------

test('the manifest does not redeclare the auto-discovered hooks file', () => {
  // hooks/hooks.json is loaded automatically. Naming it in the manifest makes
  // the plugin fail to load with "Duplicate hooks file detected".
  // `claude plugin validate` does not catch this; only a real install does.
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  if (typeof p.hooks === 'string') {
    assert.notEqual(p.hooks.replace('./', ''), 'hooks/hooks.json',
      'remove the hooks field: hooks/hooks.json is discovered automatically');
  }
});

test('allowed-tools use the documented ${CLAUDE_SKILL_DIR} form', () => {
  // Bash(node:*script.js*) does not match a real invocation with a quoted
  // absolute path; the skill then falls back to hand-writing files, which
  // silently bypasses the credential scan.
  const skillsDir = path.join(__dirname, '..', 'skills');
  for (const d of fs.readdirSync(skillsDir)) {
    const f = path.join(skillsDir, d, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, 'utf8').match(/^allowed-tools: (.*)$/m);
    if (!m) continue;
    assert.doesNotMatch(m[1], /Bash\(node:/, `${d}: the node: prefix form does not match a quoted path`);
    assert.match(m[1], /\$\{CLAUDE_SKILL_DIR\}/, `${d}: grants must use the skill-dir variable`);
  }
});

test('every skill that runs the script declares a grant for it', () => {
  const skillsDir = path.join(__dirname, '..', 'skills');
  for (const d of fs.readdirSync(skillsDir)) {
    const f = path.join(skillsDir, d, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const raw = fs.readFileSync(f, 'utf8');
    const body = raw.split(/^---$/m).slice(2).join('---');
    if (!/node "\$\{CLAUDE_SKILL_DIR\}[^"]*\.js"/.test(body)) continue;
    assert.match(raw, /^allowed-tools:/m, `${d}: runs a script but declares no grant, so it will prompt`);
  }
});

test('every skill appears in the command reference', () => {
  // A command that exists but is undocumented is invisible to users.
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'COMMANDS.md'), 'utf8');
  const skillsDir = path.join(__dirname, '..', 'skills');
  for (const d of fs.readdirSync(skillsDir)) {
    if (!fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))) continue;
    assert.ok(doc.includes('/' + d), `${d} is not documented in docs/COMMANDS.md`);
  }
});

test('every attic.js subcommand appears in the command reference', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'COMMANDS.md'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'skills', 'attic', 'scripts', 'attic.js'), 'utf8');
  const usage = src.match(/usage: attic\.js <([^>]+)>/);
  assert.ok(usage, 'attic.js should print a usage line listing its subcommands');
  for (const cmd of usage[1].split('|')) {
    assert.match(doc, new RegExp(`\`${cmd}[ \`<]`), `attic.js ${cmd} is not documented`);
  }
});

test('the try-attic demo script is present and executable', () => {
  const p = path.join(__dirname, '..', 'scripts', 'try-attic.sh');
  assert.ok(fs.existsSync(p), 'the demo script users are told to run must exist');
  assert.ok(fs.statSync(p).mode & 0o111, 'try-attic.sh must be executable');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /mktemp -d/, 'the demo must work in a temp dir, not the user\'s project');
  assert.match(src, /plugins\."attic@attic"\.enabled=false/, 'the Codex baseline must disable the installed plugin');
});
