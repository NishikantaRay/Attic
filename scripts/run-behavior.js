#!/usr/bin/env node
'use strict';
/**
 * run-behavior.js — automated behaviour evaluation.
 *
 * Activation evals prove the right skill fires. They say nothing about
 * whether it then does its job. This runs real headless sessions against a
 * seeded .attic/, then grades the OUTCOME mechanically: what landed on disk,
 * and what the reply did or did not contain.
 *
 * Only checks that can be decided by inspecting files and text live here.
 * Judgement calls stay in behavior.json for human grading.
 *
 * Usage:
 *   node scripts/run-behavior.js [--case beh-a1] [--json] [--claude <path>]
 *                                [--keep]   leave scratch dirs for inspection
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ATTIC_JS = path.join(ROOT, 'skills', 'attic', 'scripts', 'attic.js');

function findClaude(explicit) {
  if (explicit) return explicit;
  if (process.env.ATTIC_CLAUDE_BIN) return process.env.ATTIC_CLAUDE_BIN;
  try {
    const w = execSync('command -v claude', { encoding: 'utf8', shell: '/bin/sh' }).trim();
    if (w) return w;
  } catch (e) { /* not on PATH */ }
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    for (const d of fs.readdirSync(ext).filter((x) => x.startsWith('anthropic.claude-code-')).sort().reverse()) {
      const p = path.join(ext, d, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* none */ }
  return null;
}

function seed(dir, items) {
  fs.mkdirSync(dir, { recursive: true });
  for (const it of items) {
    const args = ['stash', '--cwd', dir, '--slug', it.slug, '--kind', it.kind || 'finding',
      '--title', it.title || it.slug, '--hook', it.hook || it.slug, '--body', it.body || 'body'];
    spawnSync(process.execPath, [ATTIC_JS, ...args], { encoding: 'utf8' });
    if (it.pinned) spawnSync(process.execPath, [ATTIC_JS, 'pin', '--cwd', dir, it.slug], { encoding: 'utf8' });
  }
}

function session(bin, dir, prompt, env, turns) {
  const res = spawnSync(bin, ['--plugin-dir', ROOT, '-p', prompt,
    '--output-format', 'text', '--max-turns', String(turns || 2), '--permission-mode', 'acceptEdits'], {
    cwd: dir, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, env || {}),
  });
  return { out: (res.stdout || '').trim(), err: res.stderr || '', status: res.status };
}

function indexSlugs(dir) {
  try {
    return fs.readFileSync(path.join(dir, '.attic', 'INDEX.md'), 'utf8')
      .split('\n').map((l) => (l.match(/^- \[([^\]]+)\]/) || [])[1]).filter(Boolean);
  } catch (e) { return []; }
}
function itemFiles(dir) {
  try { return fs.readdirSync(path.join(dir, '.attic', 'items')).filter((f) => f.endsWith('.md')); }
  catch (e) { return []; }
}

// Each case: seed, run, then assert on files and reply text.
const CASES = [
  {
    id: 'beh-a1',
    name: 'answers from the attic without re-reading files',
    seed: [{ slug: 'redis-eviction-bug', kind: 'finding', title: 'Redis evicts sessions',
      hook: 'maxmemory-policy allkeys-lru evicts session keys',
      body: 'config/redis.conf line 12 sets maxmemory-policy allkeys-lru. Fix: volatile-lru.' }],
    prompt: 'Why are users getting logged out randomly? Answer in two lines. Do not read any files.',
    check: (dir, s) => {
      const ok = [];
      ok.push([/allkeys-lru|volatile-lru/i.test(s.out), 'reply uses the stashed finding']);
      ok.push([/attic:redis-eviction-bug/.test(s.out), 'reply cites the handle']);
      return ok;
    },
  },
  {
    id: 'beh-a2',
    name: 'level off suppresses the index entirely',
    seed: [{ slug: 'secret-finding', hook: 'should not appear when off' }],
    env: { ATTIC_DEFAULT_MODE: 'off' },
    prompt: 'Quote any attic index lines in your context. If there are none, say exactly: NONE.',
    check: (dir, s) => [
      [!/secret-finding/.test(s.out), 'the index must not leak into context when off'],
      [/NONE|no attic|not.*context|OFF/i.test(s.out), 'model reports nothing injected'],
    ],
  },
  {
    id: 'beh-a3',
    name: 'stashing writes a well-formed item and one index line',
    seed: [],
    prompt: 'Use the attic-stash skill to stash this finding: src/auth.ts line 4 compares a seconds-based exp claim against Date.now() which is milliseconds, so every token looks expired. Fix is exp * 1000. Use slug auth-exp-mismatch.',
    turns: 12,
    check: (dir) => {
      const files = itemFiles(dir);
      const slugs = indexSlugs(dir);
      const out = [[files.includes('auth-exp-mismatch.md'), 'item file created']];
      out.push([slugs.filter((s) => s === 'auth-exp-mismatch').length === 1, 'exactly one index line']);
      const f = path.join(dir, '.attic', 'items', 'auth-exp-mismatch.md');
      if (fs.existsSync(f)) {
        const raw = fs.readFileSync(f, 'utf8');
        out.push([/^---\ntitle: .+\nkind: (finding|note|decision|plan|output)\ndate: \d{4}-\d{2}-\d{2}/m.test(raw), 'valid frontmatter']);
        out.push([/src\/auth\.ts/.test(raw), 'file path recorded verbatim']);
      } else out.push([false, 'valid frontmatter'], [false, 'file path recorded verbatim']);
      const v = spawnSync(process.execPath, [ATTIC_JS, 'validate', '--cwd', dir], { encoding: 'utf8' });
      out.push([v.status === 0, 'resulting attic validates']);
      return out;
    },
  },
  {
    id: 'beh-a4',
    name: 'a pinned old item survives a large index',
    seed: (() => {
      const s = [{ slug: 'pinned-rule', hook: 'the constraint that must always be present', pinned: true }];
      for (let i = 1; i <= 80; i++) s.push({ slug: `filler-${i}`, hook: `filler finding number ${i} with a reasonably long hook line` });
      return s;
    })(),
    prompt: 'List the slugs under "Pinned:" in your attic index context. If there is no Pinned section, say NONE.',
    check: (dir, s) => [
      [/pinned-rule/.test(s.out), 'the pinned item is injected despite 80 newer items'],
    ],
  },
];

function run(bin, c, keep) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `attic-beh-${c.id}-`));
  try {
    seed(dir, c.seed);
    const s = session(bin, dir, c.prompt, c.env, c.turns);
    if (s.status !== 0 && !s.out) return { id: c.id, name: c.name, error: s.err.slice(0, 200) || `exit ${s.status}` };
    const checks = c.check(dir, s).map(([pass, label]) => ({ pass: !!pass, label }));
    return { id: c.id, name: c.name, dir: keep ? dir : undefined,
             checks, pass: checks.every((x) => x.pass), reply: s.out.slice(0, 300) };
  } finally {
    if (!keep) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

function main() {
  const argv = process.argv.slice(2); const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2), n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; } }
  }
  const bin = findClaude(args.claude);
  if (!bin) { process.stderr.write('no claude binary found. Pass --claude <path> or set ATTIC_CLAUDE_BIN.\n'); process.exit(2); }

  const cases = args.case ? CASES.filter((c) => c.id === args.case) : CASES;
  if (!cases.length) { process.stderr.write('no matching cases\n'); process.exit(1); }

  const results = [];
  for (const c of cases) {
    process.stderr.write(`· ${c.id} ${c.name}\n`);
    results.push(run(bin, c, !!args.keep));
  }
  const passed = results.filter((r) => r.pass).length;
  const errors = results.filter((r) => r.error).length;
  const report = { suite: 'attic-behavior-automated', date: new Date().toISOString(),
    total: results.length, passed, failed: results.length - passed - errors, errors, results };

  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    const L = ['attic behaviour (automated)', ''];
    for (const r of results) {
      if (r.error) { L.push(`  ERROR  ${r.id}  ${r.error}`); continue; }
      L.push(`  ${r.pass ? 'PASS ' : 'FAIL '}  ${r.id}  ${r.name}`);
      for (const c of r.checks) if (!c.pass) L.push(`           missing: ${c.label}`);
    }
    L.push('', `${passed}/${results.length} passed${errors ? `, ${errors} errored` : ''}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(passed === results.length ? 0 : 1);
}

if (require.main === module) main();
module.exports = { CASES };
