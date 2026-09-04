'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.join(__dirname, '..', 'hooks');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runHook(script, input, env = {}) {
  const res = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ATTIC_DEFAULT_MODE: '', ...env },
  });
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);
  const out = res.stdout.trim();
  return out ? JSON.parse(out) : null;
}

test('activate: startup with no .attic emits full rules and a "no attic" note', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  const out = runHook('attic-activate.js', { cwd: project, reason: 'startup' }, { CLAUDE_PLUGIN_DATA: state });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /ATTIC MODE ACTIVE/);
  assert.match(ctx, /Level: full/);
  assert.match(ctx, /No \.attic\/ in this project yet/);
});

test('activate: injects the index and keeps the NEWEST items under pressure', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  fs.mkdirSync(path.join(project, '.attic', 'items'), { recursive: true });
  const lines = ['# Attic index'];
  for (let i = 1; i <= 300; i++) {
    fs.writeFileSync(path.join(project, '.attic', 'items', `item-${i}.md`),
      `---\ntitle: Item ${i}\nkind: finding\ndate: 2026-01-01\ntags: []\n---\nbody\n`);
    lines.push(`- [item-${i}](items/item-${i}.md) · finding · a reasonably long hook line for item number ${i}`);
  }
  fs.writeFileSync(path.join(project, '.attic', 'INDEX.md'), lines.join('\n') + '\n');

  const out = runHook('attic-activate.js', { cwd: project, reason: 'compact' }, { CLAUDE_PLUGIN_DATA: state });
  const ctx = out.hookSpecificOutput.additionalContext;
  // The regression this guards: the newest item must never be the one dropped.
  assert.match(ctx, /item-300\]/, 'newest item must be injected');
  assert.doesNotMatch(ctx, /item-1\]\(/, 'oldest items should be trimmed, not the newest');
  assert.match(ctx, /older item\(s\) not shown/, 'trimmed items need a discoverable summary line');
  assert.match(ctx, /finding\(\d+\)/, 'summary should count by kind');
});

test('activate: pinned items survive the trim, however old', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  fs.mkdirSync(path.join(project, '.attic', 'items'), { recursive: true });
  const lines = ['# Attic index'];
  for (let i = 1; i <= 300; i++) {
    const pinned = i === 2 ? 'pinned: true\n' : '';
    fs.writeFileSync(path.join(project, '.attic', 'items', `item-${i}.md`),
      `---\ntitle: Item ${i}\nkind: note\ndate: 2026-01-01\ntags: []\n${pinned}---\nbody\n`);
    lines.push(`- [item-${i}](items/item-${i}.md) · note · a reasonably long hook line for item number ${i}`);
  }
  fs.writeFileSync(path.join(project, '.attic', 'INDEX.md'), lines.join('\n') + '\n');

  const out = runHook('attic-activate.js', { cwd: project, reason: 'resume' }, { CLAUDE_PLUGIN_DATA: state });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Pinned:/, 'pinned block should be labelled');
  assert.match(ctx, /item-2\]/, 'a pinned old item must survive');
  assert.match(ctx, /item-300\]/, 'newest must still be there too');
});

test('activate: the injected index stays inside its byte budget', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  fs.mkdirSync(path.join(project, '.attic', 'items'), { recursive: true });
  const lines = ['# Attic index'];
  for (let i = 1; i <= 500; i++) {
    fs.writeFileSync(path.join(project, '.attic', 'items', `i${i}.md`),
      `---\ntitle: I${i}\nkind: note\ndate: 2026-01-01\ntags: []\n---\nb\n`);
    lines.push(`- [i${i}](items/i${i}.md) · note · ${'x'.repeat(80)} ${i}`);
  }
  fs.writeFileSync(path.join(project, '.attic', 'INDEX.md'), lines.join('\n') + '\n');
  const rt = require(path.join(HOOKS, 'attic-runtime.js'));
  const r = rt.loadIndex(project);
  assert.ok(Buffer.byteLength(r.text, 'utf8') <= 6144, `index text was ${Buffer.byteLength(r.text, 'utf8')} bytes`);
  assert.ok(r.hidden > 0, 'most items should be collapsed at this size');
});

test('activate: startup resets a leftover session level to the default', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  fs.writeFileSync(path.join(state, 'mode'), 'ultra\n');
  const out = runHook('attic-activate.js', { cwd: project, reason: 'startup' }, { CLAUDE_PLUGIN_DATA: state });
  assert.match(out.hookSpecificOutput.additionalContext, /Level: full/);
  assert.equal(fs.existsSync(path.join(state, 'mode')), false);
});

test('activate: resume keeps the session level', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  fs.writeFileSync(path.join(state, 'mode'), 'ultra\n');
  const out = runHook('attic-activate.js', { cwd: project, reason: 'resume' }, { CLAUDE_PLUGIN_DATA: state });
  assert.match(out.hookSpecificOutput.additionalContext, /Level: ultra/);
});

test('activate: ATTIC_DEFAULT_MODE=off emits only the off note', () => {
  const state = tmpDir('attic-state-');
  const project = tmpDir('attic-proj-');
  const out = runHook('attic-activate.js', { cwd: project, reason: 'startup' }, { CLAUDE_PLUGIN_DATA: state, ATTIC_DEFAULT_MODE: 'off' });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /installed but OFF/);
  assert.doesNotMatch(ctx, /ATTIC MODE ACTIVE/);
});

test('mode: "/attic ultra" writes the state file and confirms', () => {
  const state = tmpDir('attic-state-');
  const out = runHook('attic-mode.js', { user_input: '/attic ultra' }, { CLAUDE_PLUGIN_DATA: state });
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /full -> ultra/);
  assert.equal(fs.readFileSync(path.join(state, 'mode'), 'utf8').trim(), 'ultra');
});

test('mode: "/attic" with no level means full', () => {
  const state = tmpDir('attic-state-');
  fs.writeFileSync(path.join(state, 'mode'), 'off\n');
  const out = runHook('attic-mode.js', { user_input: '/attic' }, { CLAUDE_PLUGIN_DATA: state });
  assert.match(out.hookSpecificOutput.additionalContext, /off -> full/);
});

test('mode: "/attic off" and "stop attic" go dormant', () => {
  for (const text of ['/attic off', 'stop attic']) {
    const state = tmpDir('attic-state-');
    const out = runHook('attic-mode.js', { user_input: text }, { CLAUDE_PLUGIN_DATA: state });
    assert.match(out.hookSpecificOutput.additionalContext, /dormant/);
    assert.equal(fs.readFileSync(path.join(state, 'mode'), 'utf8').trim(), 'off');
  }
});

test('mode: "/attic default lite" persists to config.json', () => {
  const state = tmpDir('attic-state-');
  const out = runHook('attic-mode.js', { user_input: '/attic default lite' }, { CLAUDE_PLUGIN_DATA: state });
  assert.match(out.hookSpecificOutput.additionalContext, /default for new sessions/);
  const cfg = JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8'));
  assert.equal(cfg.defaultMode, 'lite');
  // and a fresh startup picks it up
  const project = tmpDir('attic-proj-');
  const start = runHook('attic-activate.js', { cwd: project, reason: 'startup' }, { CLAUDE_PLUGIN_DATA: state });
  assert.match(start.hookSpecificOutput.additionalContext, /Level: lite/);
});

test('mode: plain prompts and non-commands produce no output', () => {
  const state = tmpDir('attic-state-');
  for (const text of ['hello', 'please fix the attic in my house', '/attic-index', '/attic bogus']) {
    const out = runHook('attic-mode.js', { user_input: text }, { CLAUDE_PLUGIN_DATA: state });
    assert.equal(out, null, `unexpected output for ${JSON.stringify(text)}`);
  }
  assert.equal(fs.existsSync(path.join(state, 'mode')), false);
});

test('subagent: emits brief rules at full, nothing at lite or off', () => {
  const state = tmpDir('attic-state-');
  const full = runHook('attic-subagent.js', {}, { CLAUDE_PLUGIN_DATA: state });
  assert.match(full.hookSpecificOutput.additionalContext, /subagent/);
  for (const level of ['lite', 'off']) {
    fs.writeFileSync(path.join(state, 'mode'), level + '\n');
    assert.equal(runHook('attic-subagent.js', {}, { CLAUDE_PLUGIN_DATA: state }), null);
  }
});

test('hooks never hang on empty stdin', () => {
  const state = tmpDir('attic-state-');
  const started = Date.now();
  for (const s of ['attic-activate.js', 'attic-mode.js', 'attic-subagent.js']) {
    const res = spawnSync(process.execPath, [path.join(HOOKS, s)], {
      input: '', encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: state }, timeout: 5000,
    });
    assert.equal(res.status, 0);
  }
  assert.ok(Date.now() - started < 4000, 'hooks took too long');
});
