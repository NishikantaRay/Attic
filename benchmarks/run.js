#!/usr/bin/env node
'use strict';
/**
 * benchmarks/run.js — measure what Attic actually costs and returns.
 *
 * The honest design problem: you cannot A/B an agent session, because the
 * same prompt diverges in tool calls run to run. So this does NOT claim a
 * savings percentage. It measures one specific, reproducible thing:
 *
 *   Given knowledge that already exists, how many input tokens does a
 *   session need to answer a question about it, with and without the attic?
 *
 * Arm A (no attic): the model must find the answer by reading the repo.
 * Arm B (attic):    the answer is in the injected index / an item.
 *
 * Both arms run the same prompt against the same fixture repo, N times, and
 * report real token counts from the CLI's own usage output. Correctness is
 * checked too: a cheap wrong answer is not a win.
 *
 * Usage:
 *   node benchmarks/run.js [--runs 3] [--case cache-ttl] [--json]
 *                          [--out results.json] [--claude <path>]
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

// A fixture repo big enough that finding the answer costs real reading.
function buildFixture(dir, spec) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (let i = 1; i <= spec.noiseFiles; i++) {
    const lines = [];
    for (let j = 1; j <= 40; j++) lines.push(`export function helper${i}_${j}(x: number) { return x * ${j}; }`);
    fs.writeFileSync(path.join(dir, 'src', `module${i}.ts`), lines.join('\n') + '\n');
  }
  fs.writeFileSync(path.join(dir, 'src', spec.answerFile), spec.answerContent);
}

function runSession(bin, dir, prompt, useAttic) {
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', '12', '--permission-mode', 'acceptEdits'];
  if (useAttic) args.unshift('--plugin-dir', ROOT);
  const res = spawnSync(bin, args, {
    cwd: dir, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, useAttic ? {} : { ATTIC_DEFAULT_MODE: 'off' }),
  });
  let parsed = null;
  try { parsed = JSON.parse(res.stdout); } catch (e) { /* fall through */ }
  if (!parsed) return { error: (res.stderr || '').slice(0, 200) || `exit ${res.status}` };

  const u = parsed.usage || {};
  return {
    text: parsed.result || '',
    inputTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    outputTokens: u.output_tokens || 0,
    turns: parsed.num_turns || 0,
    costUsd: parsed.total_cost_usd || 0,
    durationMs: parsed.duration_ms || 0,
  };
}

const CASES = [
  {
    id: 'cache-ttl',
    noiseFiles: 25,
    answerFile: 'cache.ts',
    answerContent: [
      'const store = new Map<string, {v: string, at: number}>();',
      '',
      'export function get(k: string) {',
      '  // BUG: no TTL check, entries are served forever once written',
      '  return store.get(k)?.v;',
      '}',
      '',
      'export function set(k: string, v: string) {',
      '  store.set(k, { v, at: Date.now() });',
      '}',
      '',
    ].join('\n'),
    question: 'Why does the cache serve stale data? Answer in one sentence naming the file and the cause.',
    stash: {
      slug: 'cache-no-ttl',
      kind: 'finding',
      title: 'Cache serves stale entries forever',
      hook: 'src/cache.ts get() never checks the stored at timestamp, so there is no TTL',
      body: 'src/cache.ts get() returns store.get(k)?.v without comparing the stored `at` timestamp against any TTL. Entries written once are served forever. Fix: compare Date.now() - at against a max age and evict.',
    },
    // A correct answer must name the file and the actual cause.
    correct: (t) => /cache\.ts/i.test(t) && /(ttl|timestamp|expir|stale|at\b)/i.test(t),
  },
  {
    // The honest counter-case: nothing is stashed that helps, so the attic
    // is pure overhead. If this does not show a loss, the benchmark is rigged.
    id: 'cold-attic',
    noiseFiles: 4,
    answerFile: 'version.ts',
    answerContent: 'export const VERSION = "2.4.1";\n',
    question: 'What is the value of VERSION in src/version.ts? Answer with just the version string.',
    stash: {
      slug: 'unrelated-note',
      kind: 'note',
      title: 'Unrelated note about deployment',
      hook: 'deploys run from the release branch, not main',
      body: 'Deployment runs from the release branch. This has nothing to do with the question asked.',
    },
    correct: (t) => /2\.4\.1/.test(t),
  },
];

function stats(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, min: s[0], max: s[s.length - 1], mean: Math.round(sum / s.length), median: s[Math.floor(s.length / 2)] };
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

  const runs = args.runs ? parseInt(args.runs, 10) : 3;
  const cases = args.case ? CASES.filter((c) => c.id === args.case) : CASES;
  const report = { date: new Date().toISOString(), runs, cases: [] };

  for (const c of cases) {
    const arms = { noAttic: [], attic: [] };
    for (let r = 0; r < runs; r++) {
      for (const arm of ['noAttic', 'attic']) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `attic-bench-${arm}-`));
        try {
          buildFixture(dir, c);
          if (arm === 'attic') {
            spawnSync(process.execPath, [ATTIC_JS, 'stash', '--cwd', dir,
              '--slug', c.stash.slug, '--kind', c.stash.kind, '--title', c.stash.title,
              '--hook', c.stash.hook, '--body', c.stash.body], { encoding: 'utf8' });
          }
          process.stderr.write(`· ${c.id} run ${r + 1}/${runs} ${arm}\n`);
          const out = runSession(bin, dir, c.question, arm === 'attic');
          if (!out.error) out.correct = c.correct(out.text);
          arms[arm].push(out);
        } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
      }
    }

    const ok = (a) => a.filter((x) => !x.error);
    const entry = { id: c.id, question: c.question, noiseFiles: c.noiseFiles };
    for (const arm of ['noAttic', 'attic']) {
      const good = ok(arms[arm]);
      entry[arm] = {
        input: stats(good.map((x) => x.inputTokens)),
        output: stats(good.map((x) => x.outputTokens)),
        turns: stats(good.map((x) => x.turns)),
        durationMs: stats(good.map((x) => x.durationMs)),
        correct: good.filter((x) => x.correct).length,
        errors: arms[arm].length - good.length,
        samples: good.map((x) => ({ input: x.inputTokens, output: x.outputTokens, turns: x.turns, correct: x.correct })),
      };
    }
    const a = entry.noAttic.input, b = entry.attic.input;
    entry.inputDeltaPct = (a && b) ? +(100 * (b.median - a.median) / a.median).toFixed(1) : null;
    report.cases.push(entry);
  }

  const text = args.json ? JSON.stringify(report, null, 2) : render(report);
  process.stdout.write(text + '\n');
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
}

function render(r) {
  const L = [`Attic benchmark — ${r.runs} run(s) per arm, ${r.date.slice(0, 10)}`, ''];
  for (const c of r.cases) {
    L.push(`${c.id}: ${c.question}`);
    L.push(`  fixture: ${c.noiseFiles} noise files + 1 file holding the answer`);
    L.push('');
    L.push('  arm        input(med)  output(med)  turns  correct  errors');
    for (const [name, key] of [['no attic', 'noAttic'], ['attic', 'attic']]) {
      const a = c[key];
      const f = (s) => (s ? String(s.median).padStart(10) : '         -');
      L.push(`  ${name.padEnd(9)} ${f(a.input)} ${f(a.output)}  ${a.turns ? String(a.turns.median).padStart(5) : '    -'}  ${String(a.correct).padStart(7)}  ${String(a.errors).padStart(6)}`);
    }
    L.push('');
    if (c.inputDeltaPct !== null) {
      const d = c.inputDeltaPct;
      L.push(`  input tokens with attic: ${d > 0 ? '+' : ''}${d}% vs without (median)`);
    }
    if (c.attic.correct < c.attic.samples.length || c.noAttic.correct < c.noAttic.samples.length) {
      L.push('  NOTE: not every run answered correctly. A cheaper wrong answer is not a win.');
    }
    L.push('');
  }
  L.push('Token counts come from the CLI\'s own usage output. Small sample:');
  L.push('treat the direction as the signal, not the exact figure.');
  return L.join('\n');
}

if (require.main === module) main();
module.exports = { CASES, buildFixture };
