'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'skills', 'attic', 'scripts', 'attic.js');
const lib = require(SCRIPT);

function proj() { return fs.mkdtempSync(path.join(os.tmpdir(), 'attic-p-')); }
function run(cwd, args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd, '--json'], { encoding: 'utf8' });
  return { status: res.status, out: res.stdout.trim() ? JSON.parse(res.stdout) : null, stderr: res.stderr };
}
function stash(cwd, extra = []) {
  return run(cwd, ['stash', '--slug', 'demo-finding', '--kind', 'finding', '--title', 'Demo finding',
    '--hook', 'a short hook', '--body', 'Body text at src/a.ts:12.', ...extra]);
}

test('stash writes item, index line and is idempotent on the index', () => {
  const cwd = proj();
  const a = stash(cwd);
  assert.equal(a.status, 0);
  assert.equal(a.out.handle, 'attic:demo-finding');
  const item = fs.readFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), 'utf8');
  assert.match(item, /^---\ntitle: Demo finding\nkind: finding\ndate: \d{4}-\d{2}-\d{2}\n/);
  assert.match(item, /src\/a\.ts:12/);

  const b = stash(cwd, ['--body', 'Second pass.']);
  assert.equal(b.out.appended, true);
  const idx = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  assert.equal(idx.split('\n').filter((l) => l.includes('demo-finding')).length, 1, 'index line must not duplicate');
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), 'utf8'), /## Update \d{4}-\d{2}-\d{2}/);
});

test('kind decision also appends to DECISIONS.md', () => {
  const cwd = proj();
  const r = run(cwd, ['stash', '--slug', 'use-x', '--kind', 'decision', '--title', 'Use X',
    '--hook', 'x beats y', '--decision-why', 'fewer moving parts', '--body', 'Chose X.']);
  assert.equal(r.status, 0);
  const dec = fs.readFileSync(path.join(cwd, '.attic', 'DECISIONS.md'), 'utf8');
  assert.match(dec, /- \d{4}-\d{2}-\d{2} · Use X · because fewer moving parts/);
});

test('secrets are refused with exit code 2 and nothing is written', () => {
  const samples = [
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
    'export DB=postgres://user:hunter2@db.example.com/app',
    '-----BEGIN RSA PRIVATE KEY-----',
    'api_key = "s3cr3tvalue1234"',
  ];
  for (const s of samples) {
    const cwd = proj();
    const r = run(cwd, ['stash', '--slug', 'leak', '--kind', 'note', '--hook', 'h', '--body', s]);
    assert.equal(r.status, 2, `expected refusal for: ${s}`);
    assert.equal(r.out.refused, true);
    assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'leak.md')), false);
  }
});

test('placeholder credentials are not false positives', () => {
  for (const s of ['password = <your-password>', 'api_key: ${API_KEY}', 'secret = "REDACTED"', 'password: changeme']) {
    assert.deepEqual(lib.scanSecrets(s), [], `false positive on: ${s}`);
  }
});

test('bad input is rejected', () => {
  const cwd = proj();
  assert.equal(run(cwd, ['stash', '--kind', 'finding', '--hook', 'h', '--body', 'b']).status, 1, 'missing slug');
  assert.equal(run(cwd, ['stash', '--slug', 's', '--kind', 'bogus', '--hook', 'h', '--body', 'b']).status, 1, 'bad kind');
  assert.equal(run(cwd, ['stash', '--slug', 's', '--kind', 'note', '--hook', 'h', '--body', '  ']).status, 1, 'empty body');
  // an over-long hook is truncated, not rejected: formatting is the script's job
  const long = run(cwd, ['stash', '--slug', 'long-hook', '--kind', 'note', '--hook', 'word '.repeat(40), '--body', 'b']);
  assert.equal(long.status, 0);
  const line = long.out.indexLine.split(' · ').slice(2).join(' · ');
  assert.ok(line.length <= 100, `hook not capped: ${line.length}`);
  assert.match(line, /\u2026$/, 'truncated hook should end with an ellipsis');
});

test('slugify normalises titles', () => {
  assert.equal(lib.slugify('Login Test Times Out!'), 'login-test-times-out');
  assert.equal(lib.slugify('  --Weird__Input--  '), 'weird-input');
});

test('recall finds by slug, by words, and reports misses', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['stash', '--slug', 'other-thing', '--kind', 'note', '--hook', 'unrelated', '--body', 'about caching']);
  assert.equal(run(cwd, ['recall', 'demo-finding']).out.slug, 'demo-finding');
  assert.equal(run(cwd, ['recall', 'caching']).out.slug, 'other-thing');
  const miss = run(cwd, ['recall', 'nonexistent-topic-xyz']);
  assert.equal(miss.status, 1);
  assert.match(miss.out.error, /nothing in the attic matches/);
});

test('recall on an empty project fails cleanly', () => {
  const r = run(proj(), ['recall', 'anything']);
  assert.equal(r.status, 1);
  assert.match(r.out.error, /no \.attic\//);
});

test('index reports counts and recent decisions', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['stash', '--slug', 'd1', '--kind', 'decision', '--title', 'D1', '--hook', 'h', '--decision-why', 'w', '--body', 'b']);
  const r = run(cwd, ['index']);
  assert.equal(r.out.counts.items, 2);
  assert.equal(r.out.counts.decisions, 1);
});

test('validate passes on a healthy attic and catches drift', () => {
  const cwd = proj();
  stash(cwd);
  assert.equal(run(cwd, ['validate']).status, 0);

  // orphaned item file
  fs.writeFileSync(path.join(cwd, '.attic', 'items', 'orphan.md'), '---\ntitle: O\nkind: note\ndate: 2026-01-01\ntags: []\n---\nbody\n');
  let r = run(cwd, ['validate']);
  assert.equal(r.status, 3);
  assert.ok(r.out.problems.some((p) => p.slug === 'orphan' && /not listed in INDEX/.test(p.msg)));

  // stale index line
  const cwd2 = proj();
  stash(cwd2);
  fs.unlinkSync(path.join(cwd2, '.attic', 'items', 'demo-finding.md'));
  r = run(cwd2, ['validate']);
  assert.equal(r.status, 3);
  assert.ok(r.out.problems.some((p) => /missing item file/.test(p.msg)));

  // malformed frontmatter
  const cwd3 = proj();
  stash(cwd3);
  fs.writeFileSync(path.join(cwd3, '.attic', 'items', 'demo-finding.md'), 'no frontmatter here\n');
  r = run(cwd3, ['validate']);
  assert.equal(r.status, 3);
  assert.ok(r.out.problems.some((p) => /missing title/.test(p.msg)));
});

test('validate flags a credential that reached disk', () => {
  const cwd = proj();
  stash(cwd);
  fs.appendFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), '\nAKIAIOSFODNN7EXAMPLE\n');
  const r = run(cwd, ['validate']);
  assert.equal(r.status, 3);
  assert.ok(r.out.problems.some((p) => /AWS access key/.test(p.msg)));
});

test('validate is silent on a project with no attic', () => {
  const r = run(proj(), ['validate']);
  assert.equal(r.status, 0);
  assert.match(r.out.note, /no \.attic\//);
});

// ---------- v1.1: pin, archive, prune ----------

function backdate(cwd, slug, date) {
  const f = path.join(cwd, '.attic', 'items', slug + '.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/date: \d{4}-\d{2}-\d{2}/, 'date: ' + date));
}

test('pin marks an item and unpin reverses it', () => {
  const cwd = proj();
  stash(cwd);
  const p = run(cwd, ['pin', 'demo-finding']);
  assert.equal(p.status, 0);
  assert.equal(p.out.pinned, true);
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), 'utf8'), /\npinned: true/);

  const u = run(cwd, ['pin', 'demo-finding', '--unpin']);
  assert.equal(u.out.pinned, false);
  assert.doesNotMatch(fs.readFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), 'utf8'), /pinned: true/);

  assert.equal(run(cwd, ['pin', 'no-such-item']).status, 1);
});

test('pinning survives a later stash to the same slug', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['pin', 'demo-finding']);
  stash(cwd, ['--body', 'more detail']);
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'), 'utf8'), /\npinned: true/,
    'an append must not silently unpin the item');
});

test('archive moves an item out of the index but keeps it recallable', () => {
  const cwd = proj();
  stash(cwd);
  const a = run(cwd, ['archive', 'demo-finding']);
  assert.equal(a.status, 0);
  assert.equal(a.out.archived, true);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'demo-finding.md')), false);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'archive', 'demo-finding.md')), true);
  assert.doesNotMatch(fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8'), /demo-finding/);

  const r = run(cwd, ['recall', 'demo-finding']);
  assert.equal(r.status, 0, 'an archived item must still be recallable');
  assert.equal(r.out.slug, 'demo-finding');

  const back = run(cwd, ['archive', 'demo-finding', '--restore']);
  assert.equal(back.out.archived, false);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'demo-finding.md')), true);
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8'), /demo-finding/);
});

test('prune is a dry run by default and never deletes', () => {
  const cwd = proj();
  stash(cwd);
  backdate(cwd, 'demo-finding', '2020-01-01');
  const dry = run(cwd, ['prune', '--older-than', '90d']);
  assert.equal(dry.status, 0);
  assert.equal(dry.out.applied, false);
  assert.equal(dry.out.candidates.length, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'demo-finding.md')), true,
    'dry run must not move anything');
});

test('prune --apply archives rather than deleting, and skips pinned items', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['stash', '--slug', 'pinned-old', '--kind', 'note', '--hook', 'h', '--body', 'b']);
  backdate(cwd, 'demo-finding', '2020-01-01');
  backdate(cwd, 'pinned-old', '2020-01-01');
  run(cwd, ['pin', 'pinned-old']);

  const r = run(cwd, ['prune', '--older-than', '90d', '--apply']);
  assert.equal(r.out.applied, true);
  assert.equal(r.out.skippedPinned, 1, 'pinned items must be skipped');
  assert.equal(r.out.candidates.length, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'archive', 'demo-finding.md')), true, 'archived, not deleted');
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'pinned-old.md')), true, 'pinned item untouched');
});

test('prune respects --kind and rejects a bad age', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['stash', '--slug', 'old-out', '--kind', 'output', '--hook', 'h', '--body', 'b']);
  backdate(cwd, 'demo-finding', '2020-01-01');
  backdate(cwd, 'old-out', '2020-01-01');
  const r = run(cwd, ['prune', '--older-than', '90d', '--kind', 'output']);
  assert.deepEqual(r.out.candidates.map((c) => c.slug), ['old-out']);
  assert.equal(run(cwd, ['prune', '--older-than', 'soon']).status, 1);
});

test('recent items are not pruned', () => {
  const cwd = proj();
  stash(cwd);
  const r = run(cwd, ['prune', '--older-than', '90d']);
  assert.equal(r.out.candidates.length, 0);
});

// ---------- regressions found in the v1.1 audit ----------

test('concurrent stashes do not lose index lines', async () => {
  const cwd = proj();
  const { spawn } = require('node:child_process');
  await Promise.all([...Array(8)].map((_, i) => new Promise((res) => {
    const c = spawn(process.execPath, [SCRIPT, 'stash', '--slug', `race-${i}`, '--kind', 'note',
      '--hook', `h${i}`, '--body', 'b', '--cwd', cwd], { stdio: 'ignore' });
    c.on('exit', res);
  })));
  const idx = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  const lines = idx.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 8, 'every concurrent stash must reach the index');
  assert.equal(fs.readdirSync(path.join(cwd, '.attic', 'items')).length, 8);
  assert.equal(run(cwd, ['validate']).status, 0, 'a raced attic must still validate');
});

test('stash leaves no lock directory behind', () => {
  const cwd = proj();
  stash(cwd);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'INDEX.md.lock')), false);
});

test('validate renders its problems instead of "undefined"', () => {
  const cwd = proj();
  stash(cwd);
  fs.writeFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'total garbage\n');
  const res = spawnSync(process.execPath, [SCRIPT, 'validate', '--cwd', cwd], { encoding: 'utf8' });
  assert.equal(res.status, 3);
  assert.doesNotMatch(res.stdout, /undefined/, 'the human renderer must not print undefined');
  assert.match(res.stdout, /ERROR .*not listed in INDEX/);
});

test('rebuild regenerates the index from item files', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['stash', '--slug', 'second', '--kind', 'note', '--hook', 'h', '--body', 'b']);
  fs.writeFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'total garbage\n');

  const dry = run(cwd, ['rebuild', '--dry-run']);
  assert.equal(dry.out.applied, false);
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8'), /garbage/, 'dry run must not write');

  const r = run(cwd, ['rebuild']);
  assert.equal(r.out.applied, true);
  assert.equal(r.out.items, 2);
  assert.deepEqual(r.out.recovered.sort(), ['demo-finding', 'second']);
  assert.equal(run(cwd, ['validate']).status, 0);
});

test('rebuild drops index lines whose item file is gone', () => {
  const cwd = proj();
  stash(cwd);
  fs.unlinkSync(path.join(cwd, '.attic', 'items', 'demo-finding.md'));
  const r = run(cwd, ['rebuild']);
  assert.deepEqual(r.out.dropped, ['demo-finding']);
  assert.equal(run(cwd, ['validate']).status, 0);
});

test('rebuild preserves existing hooks rather than regenerating them', () => {
  const cwd = proj();
  stash(cwd);
  run(cwd, ['rebuild']);
  assert.match(fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8'), /a short hook/);
});

test('a hook cannot forge index structure', () => {
  const cwd = proj();
  run(cwd, ['stash', '--slug', 'inj', '--kind', 'note', '--body', 'b',
    '--hook', 'fake](evil.md) · note · injected']);
  const idx = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  const lines = idx.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 1, 'a crafted hook must not produce a second entry');
  assert.doesNotMatch(lines[0].split(' · ').slice(2).join(' · '), /·/, 'separator must be neutralised in the hook');
  assert.equal(run(cwd, ['validate']).status, 0);
});

test('a path-traversal slug cannot escape the items directory', () => {
  const cwd = proj();
  const r = run(cwd, ['stash', '--slug', '../../etc/evil', '--kind', 'note', '--hook', 'h', '--body', 'b']);
  assert.equal(r.status, 0);
  assert.ok(!r.out.file.includes('..'), `escaped: ${r.out.file}`);
  assert.ok(fs.readdirSync(path.join(cwd, '.attic', 'items')).every((f) => !f.includes('..')));
});

test('a filesystem failure reports rather than crashing', () => {
  const cwd = proj();
  const ro = path.join(cwd, 'ro');
  fs.mkdirSync(ro);
  fs.chmodSync(ro, 0o555);
  try {
    const res = spawnSync(process.execPath, [SCRIPT, 'stash', '--slug', 'x', '--kind', 'note',
      '--hook', 'h', '--body', 'b', '--cwd', ro], { encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /permission denied/);
    assert.doesNotMatch(res.stderr, /at Object\./, 'must not dump a stack trace');
  } finally { fs.chmodSync(ro, 0o755); }
});

test('unicode survives a stash and recall round trip', () => {
  const cwd = proj();
  run(cwd, ['stash', '--slug', 'uni', '--kind', 'note', '--hook', 'café ☕', '--body', 'émoji 🎉 中文']);
  const r = run(cwd, ['recall', 'uni']);
  assert.match(r.out.body, /émoji 🎉 中文/);
});

test('a v1.0-era attic works unchanged under v1.1', () => {
  const cwd = proj();
  // No archive/ dir, no pinned field: exactly what 1.0.0 produced.
  fs.mkdirSync(path.join(cwd, '.attic', 'items'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.attic', 'INDEX.md'),
    '# Attic index\n\n- [old-item](items/old-item.md) · finding · a v1.0 era hook\n');
  fs.writeFileSync(path.join(cwd, '.attic', 'items', 'old-item.md'),
    '---\ntitle: Old item\nkind: finding\ndate: 2026-01-01\ntags: [legacy]\n---\nBody.\n');

  assert.equal(run(cwd, ['validate']).status, 0, 'an old attic must still validate');
  assert.equal(run(cwd, ['index']).out.counts.items, 1);
  assert.equal(run(cwd, ['recall', 'old-item']).out.slug, 'old-item');
  assert.equal(run(cwd, ['pin', 'old-item']).out.pinned, true, 'pin works on an item with no pinned field');
  assert.equal(run(cwd, ['prune', '--older-than', '1d']).out.skippedPinned, 1);
});

test('an empty .attic directory degrades gracefully', () => {
  const cwd = proj();
  fs.mkdirSync(path.join(cwd, '.attic'), { recursive: true });
  assert.equal(run(cwd, ['validate']).status, 0);
  assert.equal(run(cwd, ['index']).status, 1, 'index reports absence rather than crashing');
  const rt = require(path.join(__dirname, '..', 'hooks', 'attic-runtime.js'));
  assert.equal(rt.loadIndex(cwd), null, 'no index means nothing injected');
});
