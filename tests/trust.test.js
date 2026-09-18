'use strict';
/**
 * Trust metadata, provenance and freshness (1.6).
 *
 * The tests that matter most here are the backward-compatibility ones: an
 * attic written by 1.5 has no trust metadata at all, and every one of these
 * code paths has to treat that as "unknown" rather than as an error or as a
 * reason to warn about everything.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'skills', 'attic', 'scripts', 'attic.js');
const lib = require(SCRIPT);
const freshness = require(path.join(__dirname, '..', 'skills', 'attic', 'scripts', 'freshness.js'));

function proj() { return fs.mkdtempSync(path.join(os.tmpdir(), 'attic-t-')); }

function run(cwd, args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd, '--json'], { encoding: 'utf8' });
  return { status: res.status, out: res.stdout.trim() ? JSON.parse(res.stdout) : null, stderr: res.stderr };
}
function runText(cwd, args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8' });
  return { status: res.status, text: res.stdout };
}
function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}
/** A scratch git repo with one committed file. */
function repo() {
  const cwd = proj();
  git(cwd, ['init', '-q', '.']);
  git(cwd, ['config', 'user.email', 't@example.com']);
  git(cwd, ['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'auth.js'), 'const a = 1;\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init']);
  return cwd;
}
function itemOf(cwd, slug) {
  return fs.readFileSync(path.join(cwd, '.attic', 'items', slug + '.md'), 'utf8');
}

// ---------- metadata ----------

test('new trust metadata is written to the item', () => {
  const cwd = repo();
  const r = run(cwd, ['stash', '--slug', 'f1', '--kind', 'finding', '--type', 'finding',
    '--confidence', 'verified', '--files', 'src/auth.js', '--commands', 'rg auth src',
    '--title', 'Auth runs late', '--hook', 'auth late', '--body', 'Body.']);
  assert.equal(r.status, 0);
  const item = itemOf(cwd, 'f1');
  assert.match(item, /^type: finding$/m);
  assert.match(item, /^confidence: verified$/m);
  assert.match(item, /^files: \[src\/auth\.js\]$/m);
  assert.match(item, /^commands: \[rg auth src\]$/m);
  assert.match(item, /^revision: [0-9a-f]{7,}$/m);
  assert.match(item, /^verified_at: \d{4}-\d{2}-\d{2}$/m);
});

test('an item with no trust flags gets the least-assumptive defaults, never verified', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'f2', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const item = itemOf(cwd, 'f2');
  assert.match(item, /^confidence: unverified$/m,
    'saving is not evidence of checking; the default must not be verified');
  assert.doesNotMatch(item, /^verified_at:/m);
});

test('core frontmatter keeps its historical shape and order', () => {
  const cwd = proj();
  run(cwd, ['stash', '--slug', 'f3', '--kind', 'note', '--title', 'T', '--hook', 'h',
    '--tags', 'a,b', '--body', 'B.']);
  // A 1.5 reader parses line-by-line from the top; the first four fields must
  // still be exactly these, in this order.
  assert.match(itemOf(cwd, 'f3'), /^---\ntitle: T\nkind: note\ndate: \d{4}-\d{2}-\d{2}\ntags: \[a, b\]\n/);
});

test('renderItem preserves keys it does not know about', () => {
  // Before 1.6 renderItem was a filter: an unrecognised key was dropped on the
  // next write, so a passing `pin` would silently delete metadata a newer
  // writer had added. That must not regress.
  const out = lib.renderItem(
    { title: 'T', kind: 'note', date: '2026-01-01', tags: [], future_field: 'keep me' },
    'Body.'
  );
  assert.match(out, /^future_field: keep me$/m);
});

test('pinning an item does not strip its trust metadata', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'f4', '--kind', 'finding', '--confidence', 'verified',
    '--files', 'src/auth.js', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  run(cwd, ['pin', 'f4']);
  const item = itemOf(cwd, 'f4');
  assert.match(item, /^confidence: verified$/m);
  assert.match(item, /^files: \[src\/auth\.js\]$/m);
  assert.match(item, /^pinned: true$/m);
});

test('pinned stays inside the first 512 bytes that the hook reads', () => {
  // hooks/attic-runtime.js readPinned() only reads the head of each file. If a
  // long files/commands list pushed `pinned:` past that window, pinned items
  // would silently start being trimmed out of the injected index.
  const cwd = repo();
  const many = Array.from({ length: 20 }, (_, i) => `src/file-with-a-long-name-${i}.js`).join(',');
  run(cwd, ['stash', '--slug', 'f5', '--kind', 'finding', '--files', many,
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  run(cwd, ['pin', 'f5']);
  const head = itemOf(cwd, 'f5').slice(0, 512);
  assert.match(head, /\npinned: true/);
});

test('an unknown --type or --confidence is rejected rather than silently dropped', () => {
  const cwd = proj();
  const a = run(cwd, ['stash', '--slug', 'f6', '--type', 'nonsense', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(a.status, 1);
  assert.match(a.out.error, /--type must be one of/);
  const b = run(cwd, ['stash', '--slug', 'f7', '--confidence', 'verifed', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(b.status, 1);
  assert.match(b.out.error, /--confidence must be one of/);
});

test('failed-approach and workaround are types, and kind stays in the old vocabulary', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'fa1', '--kind', 'finding', '--type', 'failed-approach',
    '--title', 'Tried X', '--hook', 'X failed because Y', '--body', 'Tried X. It failed.']);
  assert.match(itemOf(cwd, 'fa1'), /^type: failed-approach$/m);
  // The INDEX line's kind field is matched as [a-z]+ by this script, by
  // hooks/attic-runtime.js and by the generated codex copy. A hyphen there
  // would make the line unparseable and the item would vanish from the index.
  const idx = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  const line = idx.split('\n').find((l) => l.includes('fa1'));
  assert.ok(lib.parseIndexLine(line), 'index line must still parse');
  assert.equal(lib.parseIndexLine(line).kind, 'finding');
});

// ---------- privacy ----------

test('a command containing a credential is dropped, and the stash still succeeds', () => {
  const cwd = repo();
  const r = run(cwd, ['stash', '--slug', 'p1', '--kind', 'finding',
    '--commands', 'curl -H "api_key: aB3xY9zQ1mN7pL4k" https://x.test\nnpm test',
    '--title', 'T', '--hook', 'h', '--body', 'Body.']);
  assert.equal(r.status, 0, 'losing one evidence line must not cost the whole finding');
  const item = itemOf(cwd, 'p1');
  assert.doesNotMatch(item, /aB3xY9zQ1mN7pL4k/);
  assert.match(item, /npm test/, 'the safe command is kept');
});

test('absolute file paths are stored repo-relative, not as home directory paths', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'p2', '--kind', 'finding',
    '--files', path.join(cwd, 'src', 'auth.js'),
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const item = itemOf(cwd, 'p2');
  assert.match(item, /^files: \[src\/auth\.js\]$/m);
  assert.doesNotMatch(item, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'an absolute path would leak the machine layout and break on clone');
});

test('a non-http source url is not stored', () => {
  const cwd = proj();
  run(cwd, ['stash', '--slug', 'p3', '--kind', 'note', '--source-url', 'javascript:alert(1)',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.doesNotMatch(itemOf(cwd, 'p3'), /source_url/);
});

// ---------- freshness ----------

test('an unchanged repository reports current', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c1', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const r = run(cwd, ['recall', 'c1']);
  assert.equal(r.out.freshness.status, 'current');
});

test('an uncommitted edit to a referenced file reports possibly-stale with the right path', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c2', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  const r = run(cwd, ['recall', 'c2']);
  assert.equal(r.out.freshness.status, 'possibly-stale');
  // Regression: git status --porcelain pads unstaged edits to " M path".
  // Trimming that output shifted the record and produced "rc/auth.js".
  assert.deepEqual(r.out.freshness.changedFiles, ['src/auth.js']);
});

test('a committed change to a referenced file reports possibly-stale', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c3', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'change']);
  const r = run(cwd, ['recall', 'c3']);
  assert.equal(r.out.freshness.status, 'possibly-stale');
  assert.deepEqual(r.out.freshness.changedFiles, ['src/auth.js']);
});

test('a path containing a space is reported intact', () => {
  const cwd = repo();
  fs.mkdirSync(path.join(cwd, 'src', 'we ird'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'we ird', 'a b.js'), 'x\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'sp']);
  run(cwd, ['stash', '--slug', 'c4', '--kind', 'finding', '--files', 'src/we ird/a b.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.appendFileSync(path.join(cwd, 'src', 'we ird', 'a b.js'), 'y\n');
  const r = run(cwd, ['recall', 'c4']);
  // Without --porcelain -z, git quotes and escapes this path.
  assert.deepEqual(r.out.freshness.changedFiles, ['src/we ird/a b.js']);
});

test('a change to an unrelated file does not make a finding stale', () => {
  // The documented policy: a repository that moved on is not evidence about a
  // finding whose own files nobody touched. Marking everything stale after one
  // unrelated commit would make the warning worthless.
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c5', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.writeFileSync(path.join(cwd, 'unrelated.js'), 'x\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'unrelated']);
  const r = run(cwd, ['recall', 'c5']);
  assert.equal(r.out.freshness.status, 'current');
});

test('a deleted referenced file reports needs-review', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c6', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.unlinkSync(path.join(cwd, 'src', 'auth.js'));
  const r = run(cwd, ['recall', 'c6']);
  assert.equal(r.out.freshness.status, 'needs-review');
  assert.deepEqual(r.out.freshness.missingFiles, ['src/auth.js']);
});

test('an item naming no files goes stale only when the revision itself moves', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c7', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(run(cwd, ['recall', 'c7']).out.freshness.status, 'current');
  fs.writeFileSync(path.join(cwd, 'other.js'), 'x\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'move']);
  assert.equal(run(cwd, ['recall', 'c7']).out.freshness.status, 'possibly-stale');
});

test('a workaround always asks to be reviewed', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c8', '--kind', 'note', '--type', 'workaround',
    '--title', 'T', '--hook', 'h', '--body', 'Temporary.']);
  assert.equal(run(cwd, ['recall', 'c8']).out.freshness.status, 'needs-review');
});

test('freshness in a non-git directory is unknown, not an error', () => {
  const cwd = proj();
  run(cwd, ['stash', '--slug', 'c9', '--kind', 'note', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const r = run(cwd, ['recall', 'c9']);
  assert.equal(r.status, 0);
  assert.equal(r.out.freshness.status, 'unknown');
  assert.match(r.out.freshness.reason, /not a git repository/);
});

test('a repository with no commits does not crash freshness', () => {
  const cwd = proj();
  git(cwd, ['init', '-q', '.']);
  const r = run(cwd, ['stash', '--slug', 'c10', '--kind', 'note', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(r.status, 0);
  assert.equal(run(cwd, ['recall', 'c10']).status, 0);
});

test('a revision from another repository is unknown, not stale', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'c11', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const f = path.join(cwd, '.attic', 'items', 'c11.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^revision: .*$/m, 'revision: deadbee'));
  const r = run(cwd, ['recall', 'c11']);
  assert.equal(r.out.freshness.status, 'unknown');
  assert.match(r.out.freshness.reason, /not in this repository/);
});

test('freshness never throws on missing or malformed metadata', () => {
  const cwd = repo();
  for (const meta of [{}, { files: 'src/auth.js' }, { revision: '' }, { files: [] },
                      { revision: 'zzz', files: ['nope.js'] }, { type: 'workaround' }]) {
    const r = freshness.evaluate(cwd, meta);
    assert.ok(freshness.STATUSES.includes(r.status), `bad status for ${JSON.stringify(meta)}`);
  }
  assert.equal(freshness.evaluate(cwd, null).status, 'unknown');
  assert.equal(freshness.evaluate(cwd, undefined).status, 'unknown');
});

test('a detached HEAD still resolves a revision', () => {
  const cwd = repo();
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// two\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'second']);
  git(cwd, ['checkout', '-q', 'HEAD~1']);
  assert.ok(freshness.currentRevision(cwd), 'detached HEAD has a resolvable SHA');
  const r = run(cwd, ['stash', '--slug', 'c12', '--kind', 'note', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(r.status, 0);
});

// ---------- backward compatibility ----------

test('a 1.5 item with no trust metadata reads, recalls and reviews cleanly', () => {
  const cwd = repo();
  // Exactly what 1.5 wrote: four fields, nothing else.
  fs.mkdirSync(path.join(cwd, '.attic', 'items'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.attic', 'INDEX.md'),
    '# Attic index\n\n- [old](items/old.md) · finding · an old hook\n');
  fs.writeFileSync(path.join(cwd, '.attic', 'items', 'old.md'),
    '---\ntitle: Old finding\nkind: finding\ndate: 2026-01-01\ntags: [x]\n---\n\nOld body.\n');

  const r = run(cwd, ['recall', 'old']);
  assert.equal(r.status, 0);
  assert.equal(r.out.freshness.status, 'unknown');
  assert.equal(run(cwd, ['validate']).status, 0);

  // And it is NOT dragged into the review list: every pre-1.6 item showing up
  // as a problem on first upgrade would make the command useless.
  const rev = run(cwd, ['review']);
  assert.equal(rev.out.needingReview, 0);
  assert.equal(run(cwd, ['review', '--all']).out.needingReview, 1, '--all opts in');
});

test('recall output for a pre-1.6 item gains no trust noise', () => {
  const cwd = proj();
  fs.mkdirSync(path.join(cwd, '.attic', 'items'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.attic', 'INDEX.md'),
    '# Attic index\n\n- [old](items/old.md) · note · hook\n');
  fs.writeFileSync(path.join(cwd, '.attic', 'items', 'old.md'),
    '---\ntitle: Old\nkind: note\ndate: 2026-01-01\ntags: []\n---\n\nBody.\n');
  const { text } = runText(cwd, ['recall', 'old']);
  assert.doesNotMatch(text, /unknown/, 'an old item should look as it did in 1.5');
  assert.match(text, /Body\./);
});

test('editing a 1.5 item does not invent trust metadata for it', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'e1', '--kind', 'note', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const f = path.join(cwd, '.attic', 'items', 'e1.md');
  fs.writeFileSync(f, '---\ntitle: T\nkind: note\ndate: 2026-01-01\ntags: []\n---\n\nB.\n');
  run(cwd, ['edit', '--slug', 'e1', '--body', 'Changed.']);
  const item = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(item, /confidence:/, 'an edit is not a claim about provenance');
  assert.match(item, /Changed\./);
});

// ---------- recall output ----------

test('recall shows evidence and a stale warning, and stays compact', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'r1', '--kind', 'finding', '--confidence', 'verified',
    '--files', 'src/auth.js', '--title', 'Auth runs late', '--hook', 'h', '--body', 'Short body.']);
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  const { text } = runText(cwd, ['recall', 'r1']);
  assert.match(text, /finding · verified · possibly-stale/);
  assert.match(text, /evidence: src\/auth\.js/);
  assert.match(text, /⚠ Possibly stale/);
  assert.match(text, /Verify against the current working tree/);
  assert.ok(text.split('\n').length < 20, 'recall must stay compact');
});

test('a current item spends one line on trust, not a block', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'r2', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'Body.']);
  const { text } = runText(cwd, ['recall', 'r2']);
  assert.match(text, /finding · unverified · current/);
  assert.doesNotMatch(text, /⚠/, 'no warning where there is nothing to act on');
});

test('an item citing many files does not print all of them', () => {
  const cwd = repo();
  const many = Array.from({ length: 20 }, (_, i) => `src/f${i}.js`);
  for (const f of many) fs.writeFileSync(path.join(cwd, f), 'x\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'many']);
  run(cwd, ['stash', '--slug', 'r3', '--kind', 'finding', '--files', many.join(','),
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const { text } = runText(cwd, ['recall', 'r3']);
  assert.match(text, /\(\+\d+ more\)/, 'evidence list must be bounded');
});

test('--no-freshness skips the git check entirely', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'r4', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const r = run(cwd, ['recall', 'r4', '--no-freshness']);
  assert.equal(r.status, 0);
  assert.equal(r.out.freshness, undefined);
});

test('the injected index line is unchanged by trust metadata', () => {
  // The index is injected into every session, so its per-item cost is the one
  // number that must not drift. Trust metadata lives in the item, not here.
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'r5', '--kind', 'finding', '--type', 'failed-approach',
    '--confidence', 'verified', '--files', 'src/auth.js', '--commands', 'npm test',
    '--title', 'T', '--hook', 'a short hook', '--body', 'B.']);
  const idx = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  assert.match(idx, /^- \[r5\]\(items\/r5\.md\) · finding · a short hook$/m);
});

// ---------- failed approaches ----------

test('a failed approach is recallable and keeps its evidence and reason', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'fa2', '--kind', 'finding', '--type', 'failed-approach',
    '--confidence', 'verified', '--files', 'src/auth.js',
    '--title', 'Tried auth in the route handler', '--hook', 'routes bypassed it',
    '--body', '## Tried\nAuth inside the handler.\n\n## Why it failed\nRoutes bypass it.']);
  const r = run(cwd, ['recall', 'auth handler']);
  assert.equal(r.out.slug, 'fa2');
  assert.equal(r.out.meta.type, 'failed-approach');
  assert.match(r.out.body, /Why it failed/);
});

test('a failed approach is searchable by its subject', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'fa3', '--kind', 'finding', '--type', 'failed-approach',
    '--title', 'Redis cache attempt', '--hook', 'redis added latency',
    '--body', 'Tried redis. Slower than the in-process map.']);
  assert.equal(run(cwd, ['recall', 'redis']).out.slug, 'fa3');
});

// ---------- review and verify ----------

test('review lists stale items and stays read-only', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v1', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const before = itemOf(cwd, 'v1');
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  const r = run(cwd, ['review']);
  assert.equal(r.out.needingReview, 1);
  assert.equal(r.out.items[0].slug, 'v1');
  assert.equal(r.out.items[0].status, 'possibly-stale');
  assert.equal(itemOf(cwd, 'v1'), before, 'review must not write');
});

test('review reports nothing when everything checks out', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v2', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  assert.equal(run(cwd, ['review']).out.needingReview, 0);
});

test('verify clears staleness, restamps the revision, and leaves the prose alone', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v3', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'Original body.']);
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'change']);
  assert.equal(run(cwd, ['recall', 'v3']).out.freshness.status, 'possibly-stale');

  const r = run(cwd, ['verify', 'v3']);
  assert.equal(r.status, 0);
  assert.equal(run(cwd, ['recall', 'v3']).out.freshness.status, 'current');
  const item = itemOf(cwd, 'v3');
  assert.match(item, /^confidence: verified$/m);
  assert.match(item, /Original body\./, 'verification restamps provenance, it does not rewrite prose');
});

test('verify --stale flags without deleting anything', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v4', '--kind', 'finding', '--files', 'src/auth.js',
    '--confidence', 'verified', '--title', 'T', '--hook', 'h', '--body', 'Body.']);
  const r = run(cwd, ['verify', 'v4', '--stale', '--note', 'no longer holds']);
  assert.equal(r.status, 0);
  const item = itemOf(cwd, 'v4');
  assert.match(item, /Body\./, 'the knowledge is kept');
  assert.match(item, /no longer holds/);
  assert.equal(run(cwd, ['recall', 'v4']).out.freshness.status, 'needs-review');
});

test('verify on a missing slug fails cleanly', () => {
  const cwd = repo();
  const r = run(cwd, ['verify', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.out.error, /no item/);
});

test('verify refuses a note containing a credential', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v5', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const r = run(cwd, ['verify', 'v5', '--note', 'checked with api_key: aB3xY9zQ1mN7pL4k']);
  assert.equal(r.status, 2);
  assert.doesNotMatch(itemOf(cwd, 'v5'), /aB3xY9zQ1mN7pL4k/);
});

test('an archived item is reported as archived, not as stale', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'v6', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.unlinkSync(path.join(cwd, 'src', 'auth.js'));
  run(cwd, ['archive', 'v6']);
  assert.equal(run(cwd, ['recall', 'v6']).out.freshness.status, 'archived');
});

// ---------- append ----------

test('re-stashing moves the revision forward and unions the evidence', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'a1', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'First.']);
  fs.writeFileSync(path.join(cwd, 'src', 'routes.js'), 'x\n');
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'more']);
  run(cwd, ['stash', '--slug', 'a1', '--kind', 'finding', '--files', 'src/routes.js',
    '--title', 'T', '--hook', 'h', '--body', 'Second.']);
  const item = itemOf(cwd, 'a1');
  assert.match(item, /^files: \[src\/auth\.js, src\/routes\.js\]$/m);
  assert.match(item, /## Update/);
  assert.match(item, /First\./);
});

test('re-stashing does not silently promote confidence', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'a2', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'First.']);
  run(cwd, ['stash', '--slug', 'a2', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'Second.']);
  assert.match(itemOf(cwd, 'a2'), /^confidence: unverified$/m);
});

test('re-stashing does not demote an item that was verified', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'a3', '--kind', 'finding', '--confidence', 'verified',
    '--title', 'T', '--hook', 'h', '--body', 'First.']);
  run(cwd, ['stash', '--slug', 'a3', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'Second.']);
  assert.match(itemOf(cwd, 'a3'), /^confidence: verified$/m);
});

// ---------- validate ----------

test('validate warns about unrecognised trust values without failing the attic', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'w1', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const f = path.join(cwd, '.attic', 'items', 'w1.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^confidence: .*$/m, 'confidence: bogus'));
  const r = run(cwd, ['validate']);
  assert.equal(r.status, 0, 'a bad label does not invalidate the knowledge');
  assert.ok(r.out.problems.some((p) => p.level === 'warn' && /unknown confidence/.test(p.msg)));
});

test('an unrecognised trust value is not echoed into recall output', () => {
  // These strings are printed into an agent's context. A hand-edited
  // `confidence: bogus` reads exactly like a real verdict, so it is dropped.
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'w2', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const f = path.join(cwd, '.attic', 'items', 'w2.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^confidence: .*$/m, 'confidence: totally-legit'));
  const { text } = runText(cwd, ['recall', 'w2']);
  assert.doesNotMatch(text, /totally-legit/);
});

test('validate flags an absolute path in files', () => {
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'w3', '--kind', 'finding', '--title', 'T', '--hook', 'h', '--body', 'B.']);
  const f = path.join(cwd, '.attic', 'items', 'w3.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^---\n/, '---\nfiles: [/etc/passwd]\n'));
  const r = run(cwd, ['validate']);
  assert.ok(r.out.problems.some((p) => /absolute path/.test(p.msg)));
});

test('review bounds its output and reports what it withheld', () => {
  const cwd = repo();
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(path.join(cwd, 'src', `f${i}.js`), 'x\n');
  }
  git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'files']);
  for (let i = 0; i < 25; i++) {
    run(cwd, ['stash', '--slug', `i${i}`, '--kind', 'finding', '--files', `src/f${i}.js`,
      '--title', `T${i}`, '--hook', `h${i}`, '--body', 'B.']);
  }
  for (let i = 0; i < 25; i++) fs.appendFileSync(path.join(cwd, 'src', `f${i}.js`), 'y\n');
  const r = run(cwd, ['review']);
  assert.equal(r.out.needingReview, 25);
  assert.equal(r.out.items.length, 20, 'output is capped');
  assert.equal(r.out.truncated, 5, 'and says how many it withheld');
});

test('a malformed --limit is an error, not an empty attic', () => {
  // NaN slices to nothing, which would render as "nothing needs review" — the
  // most misleading answer this command could give.
  const cwd = repo();
  run(cwd, ['stash', '--slug', 'lim', '--kind', 'finding', '--files', 'src/auth.js',
    '--title', 'T', '--hook', 'h', '--body', 'B.']);
  fs.appendFileSync(path.join(cwd, 'src', 'auth.js'), '// edit\n');
  const r = run(cwd, ['review', '--limit', 'abc']);
  assert.equal(r.status, 1);
  assert.match(r.out.error, /--limit takes a positive whole number/);
});
