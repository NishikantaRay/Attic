'use strict';
// The Codex build is generated. These tests fail if it drifts from the source
// or if a Claude-only construct leaks into it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CODEX = path.join(ROOT, 'codex');
const { portSkill, portFrontmatter, portBody } = require('../scripts/build-codex.js');

function build() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-codex.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `build failed: ${r.stderr}`);
}

test('the committed codex build is up to date with skills/', () => {
  const before = fs.existsSync(CODEX)
    ? fs.readdirSync(path.join(CODEX, 'skills')).map((d) =>
        fs.readFileSync(path.join(CODEX, 'skills', d, 'SKILL.md'), 'utf8')).join('\n')
    : '';
  build();
  const after = fs.readdirSync(path.join(CODEX, 'skills')).map((d) =>
    fs.readFileSync(path.join(CODEX, 'skills', d, 'SKILL.md'), 'utf8')).join('\n');
  assert.equal(after, before, 'codex/ is stale — run npm run build:codex and commit the result');
});

test('every source skill is ported', () => {
  const src = fs.readdirSync(path.join(ROOT, 'skills')).filter((d) =>
    fs.existsSync(path.join(ROOT, 'skills', d, 'SKILL.md')));
  const out = fs.readdirSync(path.join(CODEX, 'skills'));
  assert.deepEqual(out.sort(), src.sort());
});

test('no Claude-only frontmatter or variables survive the port', () => {
  for (const d of fs.readdirSync(path.join(CODEX, 'skills'))) {
    const raw = fs.readFileSync(path.join(CODEX, 'skills', d, 'SKILL.md'), 'utf8');
    const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    for (const field of ['allowed-tools', 'disable-model-invocation', 'argument-hint']) {
      assert.doesNotMatch(fm, new RegExp(`^${field}:`, 'm'), `${d}: ${field} should be stripped for Codex`);
    }
    assert.doesNotMatch(raw, /CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR/, `${d}: Claude variable leaked`);
    assert.match(fm, /^name:/m, `${d}: Codex requires name`);
    assert.match(fm, /description:/, `${d}: Codex requires description`);
  }
});

test('ported skills invoke the launcher, not a node path', () => {
  const stash = fs.readFileSync(path.join(CODEX, 'skills', 'attic-stash', 'SKILL.md'), 'utf8');
  assert.match(stash, /^attic stash/m, 'should call the attic launcher');
  assert.doesNotMatch(stash, /node "\$\{/, 'no variable-laden node invocation should remain');
});

test('portFrontmatter drops folded continuation lines with their key', () => {
  const fm = portFrontmatter([
    'name: x',
    'description: >',
    '  line one',
    '  line two',
    'allowed-tools: Bash(node:*)',
    'version: 1.0.0',
  ].join('\n'));
  assert.match(fm, /description: >/);
  assert.match(fm, /line two/, 'folded description must survive');
  assert.doesNotMatch(fm, /allowed-tools/);
  assert.match(fm, /version: 1\.0\.0/);
});

test('portBody rewrites the project-dir variable', () => {
  assert.match(portBody('uses CLAUDE_PROJECT_DIR here'), /CODEX_PROJECT_DIR/);
});

test('the launcher and installer ship and are executable', () => {
  for (const f of ['bin/attic', 'install.sh']) {
    const p = path.join(CODEX, f);
    assert.ok(fs.existsSync(p), `${f} missing`);
    assert.ok(fs.statSync(p).mode & 0o111, `${f} is not executable`);
  }
});

test('hooks are shared and carry no Claude-only variable', () => {
  const h = JSON.parse(fs.readFileSync(path.join(CODEX, 'hooks', 'hooks.json'), 'utf8'));
  const text = JSON.stringify(h);
  assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/);
  assert.match(text, /ATTIC_HOME/);
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'SubagentStart']) {
    assert.ok(h.hooks[ev], `${ev} hook missing`);
  }
});

test('the launcher finds attic.js and runs it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-cx-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-cxp-'));
  fs.cpSync(path.join(CODEX, 'skills'), path.join(home, '.codex', 'skills'), { recursive: true });
  const r = spawnSync('sh', [path.join(CODEX, 'bin', 'attic'), 'stash',
    '--slug', 'x', '--kind', 'note', '--hook', 'h', '--body', 'b'], {
    cwd: proj, encoding: 'utf8', env: Object.assign({}, process.env, { CODEX_HOME: path.join(home, '.codex') }),
  });
  assert.equal(r.status, 0, `launcher failed: ${r.stderr}`);
  assert.ok(fs.existsSync(path.join(proj, '.attic', 'items', 'x.md')));
});

test('hooks resolve state under CODEX_HOME when set', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-cxh-'));
  const r = spawnSync(process.execPath, ['-e',
    "console.log(require(process.argv[1]).stateDir())", path.join(ROOT, 'hooks', 'attic-runtime.js')], {
    encoding: 'utf8', env: Object.assign({}, process.env, { CODEX_HOME: home, CLAUDE_PLUGIN_DATA: '' }),
  });
  assert.match(r.stdout.trim(), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the repo layout is compatible with the standard skills installer', () => {
  // `npx skills add` looks for skills/<name>/SKILL.md with name + description.
  for (const d of fs.readdirSync(path.join(ROOT, 'skills'))) {
    const p = path.join(ROOT, 'skills', d, 'SKILL.md');
    if (!fs.existsSync(p)) continue;
    const fm = (fs.readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    assert.match(fm, /^name:\s*\S/m, `${d}: installer requires a name`);
    assert.match(fm, /^description:/m, `${d}: installer requires a description`);
  }
});

test('the installer merges hooks without clobbering existing ones', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-inst-'));
  const codexHome = path.join(home, '.codex');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo mine' }] }],
             Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] },
  }));
  const env = Object.assign({}, process.env, { HOME: home, CODEX_HOME: codexHome });
  const run = () => spawnSync('sh', [path.join(CODEX, 'install.sh')], { encoding: 'utf8', env });

  assert.equal(run().status, 0);
  let merged = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  let text = JSON.stringify(merged);
  assert.match(text, /echo mine/, "the user's own hook must survive");
  assert.match(text, /echo bye/, 'unrelated events must survive');
  assert.match(text, /attic-activate/, 'attic hooks must be registered');
  assert.doesNotMatch(text, /\$\{ATTIC_HOME\}/, 'paths must be resolved at install time');

  // idempotent
  assert.equal(run().status, 0);
  merged = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  const count = (JSON.stringify(merged).match(/attic-activate/g) || []).length;
  assert.equal(count, 1, 'reinstalling must not duplicate hook entries');
});

test('the installer enables the hooks feature flag', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-flag-'));
  const codexHome = path.join(home, '.codex');
  const r = spawnSync('sh', [path.join(CODEX, 'install.sh')], {
    encoding: 'utf8', env: Object.assign({}, process.env, { HOME: home, CODEX_HOME: codexHome }),
  });
  assert.equal(r.status, 0);
  const cfg = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.match(cfg, /\[features\]/);
  assert.match(cfg, /hooks\s*=\s*true/);
});

test('the skill tells the model to recover when injection did not run', () => {
  const raw = fs.readFileSync(path.join(CODEX, 'skills', 'attic', 'SKILL.md'), 'utf8');
  assert.match(raw, /no index appears in your context/i,
    'Codex can soft-restart without firing SessionStart; the skill must handle it');
});
