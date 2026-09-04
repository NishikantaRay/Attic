#!/usr/bin/env node
'use strict';
/**
 * run-evals.js — activation evaluation for the attic skills.
 *
 * Runs each activation case as a real headless Claude session with this repo
 * loaded via --plugin-dir, asks which skill it would use, and scores the
 * classification. Behaviour cases are checklists graded by a human or a judge
 * model; this runner reports them as "manual" so they stay visible.
 *
 * Usage:
 *   node scripts/run-evals.js [--suite activation] [--case act-01] [--json]
 *                             [--claude <path>] [--out <file>] [--dry-run]
 *                             [--delay <ms>]   pause between cases (avoids rate limits)
 *
 * Exit codes: 0 all pass, 1 failures, 2 could not run (no claude binary).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'skills', 'attic', 'evals');

function findClaude(explicit) {
  if (explicit) return explicit;
  if (process.env.ATTIC_CLAUDE_BIN) return process.env.ATTIC_CLAUDE_BIN;
  try {
    const which = execSync('command -v claude', { encoding: 'utf8', shell: '/bin/sh' }).trim();
    if (which) return which;
  } catch (e) { /* not on PATH */ }
  // VS Code extension ships a binary; version segment changes on update.
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const dirs = fs.readdirSync(ext).filter((d) => d.startsWith('anthropic.claude-code-')).sort().reverse();
    for (const d of dirs) {
      const p = path.join(ext, d, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* no extensions dir */ }
  return null;
}

const CLASSIFY = `You have the attic plugin loaded. A user has just sent the message below.
Answer with ONE line and nothing else: the name of the attic skill you would invoke
(one of: attic, attic-stash, attic-recall, attic-index, attic-sweep, attic-help,
attic-pin, attic-prune, attic-stats, attic-doctor, attic-git),
or the word NONE if no attic skill applies.

Do not invoke the skill. Do not explain. One word.

User message: `;

function runCase(bin, c, opts) {
  if (opts.dryRun) return { id: c.id, skipped: true };
  const res = spawnSync(bin, [
    '--plugin-dir', ROOT,
    '-p', CLASSIFY + JSON.stringify(c.prompt),
    '--output-format', 'text',
    '--max-turns', '1',
  ], { encoding: 'utf8', timeout: 120000, cwd: os.tmpdir() });

  if (res.error || res.status !== 0) {
    return { id: c.id, error: (res.error && res.error.message) || res.stderr || `exit ${res.status}` };
  }
  const raw = (res.stdout || '').trim();
  const last = raw.split('\n').filter((l) => l.trim()).pop() || '';
  const m = last.match(/\b(attic-stash|attic-recall|attic-index|attic-sweep|attic-help|attic-pin|attic-prune|attic-stats|attic-doctor|attic-git|attic|none)\b/i);
  const actual = m ? (m[1].toLowerCase() === 'none' ? null : m[1].toLowerCase()) : null;

  const activated = actual !== null;
  let result;
  if (c.should_activate && activated && actual === c.expected_skill) result = 'pass';
  else if (c.should_activate && activated) result = 'wrong-skill';
  else if (c.should_activate && !activated) result = 'false-negative';
  else if (!c.should_activate && activated) result = 'false-positive';
  else result = 'pass';

  return { id: c.id, prompt: c.prompt, expected_skill: c.expected_skill, should_activate: c.should_activate,
           actual_skill: actual, result, raw: last, ambiguous: !!c.ambiguous };
}

function score(results, cases) {
  const graded = results.filter((r) => r.result);
  const total = graded.length;
  const pass = graded.filter((r) => r.result === 'pass').length;
  const applicable = cases.filter((c) => c.should_activate).length;
  const negatives = cases.filter((c) => !c.should_activate).length;
  const fp = graded.filter((r) => r.result === 'false-positive').length;
  const fn = graded.filter((r) => r.result === 'false-negative').length;
  const wrong = graded.filter((r) => r.result === 'wrong-skill').length;
  const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : 0);
  return {
    cases: cases.length, graded: total, ungraded: cases.length - total,
    total, pass, fail: total - pass,
    activation_accuracy: pct(pass, total),
    coverage: pct(total, cases.length),
    false_positive_rate: pct(fp, negatives),
    false_negative_rate: pct(fn, applicable),
    wrong_skill_rate: pct(wrong, applicable),
    errors: results.filter((r) => r.error).length,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; }
    }
  }

  const suiteName = args.suite || 'activation';
  const suite = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, suiteName + '.json'), 'utf8'));

  if (suiteName === 'behavior') {
    const out = { suite: suite.suite, version: suite.version, mode: 'manual',
      note: 'Behaviour cases are graded against a transcript and the resulting .attic/ tree. Run them by hand or with a judge model.',
      cases: suite.cases.map((c) => ({ id: c.id, level: c.level, scenario: c.scenario,
        checks: c.required_behaviors.length + c.forbidden_behaviors.length,
        mechanically_enforced_by: c.mechanically_enforced_by || null })) };
    process.stdout.write((args.json ? JSON.stringify(out, null, 2) : renderBehavior(out)) + '\n');
    return;
  }

  const bin = findClaude(args.claude);
  if (!bin && !args['dry-run']) {
    process.stderr.write('no claude binary found. Pass --claude <path> or set ATTIC_CLAUDE_BIN.\n');
    process.exit(2);
  }

  let cases = suite.cases;
  if (args.case) cases = cases.filter((c) => c.id === args.case);
  if (!cases.length) { process.stderr.write('no matching cases\n'); process.exit(1); }

  const delayMs = args.delay ? parseInt(args.delay, 10) : 0;
  const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

  const results = [];
  for (const c of cases) {
    if (!args.json) process.stderr.write(`· ${c.id} ${JSON.stringify(c.prompt).slice(0, 60)}\n`);
    let r = runCase(bin, c, { dryRun: args['dry-run'] });
    // One retry: a long suite can trip a transient rate limit, and a
    // spawn failure is not evidence about the skill's activation.
    if (r.error && !args['dry-run']) {
      sleep(3000);
      if (!args.json) process.stderr.write(`  retrying ${c.id}\n`);
      r = runCase(bin, c, { dryRun: false });
    }
    results.push(r);
    sleep(delayMs);
  }

  const report = { suite: suite.suite, version: suite.version, date: new Date().toISOString(),
                   binary: bin, metrics: score(results, cases), results };
  const text = args.json ? JSON.stringify(report, null, 2) : renderActivation(report);
  process.stdout.write(text + '\n');
  if (args.out) { fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n'); }
  process.exit(report.metrics.fail || report.metrics.errors ? 1 : 0);
}

function renderActivation(r) {
  const m = r.metrics;
  const rows = r.results.map((x) => {
    if (x.error) return `  ERROR  ${x.id}  ${x.error.slice(0, 60)}`;
    if (x.skipped) return `  SKIP   ${x.id}`;
    const mark = x.result === 'pass' ? 'PASS  ' : 'FAIL  ';
    const detail = x.result === 'pass' ? '' : `  (${x.result}: got ${x.actual_skill || 'NONE'}, wanted ${x.expected_skill || 'NONE'})`;
    return `  ${mark} ${x.id}${detail}`;
  });
  const warn = m.errors
    ? `\n!! ${m.errors} case(s) did not run. Accuracy below covers only the ${m.graded} that did.\n` +
      `   Re-run the failed ids, or use --delay to slow the suite down.\n`
    : '';
  return [
    `${r.suite} v${r.version}`, '', rows.join('\n'), warn,
    `activation accuracy   ${m.activation_accuracy}%  (${m.pass}/${m.graded})`,
    `coverage              ${m.coverage}%  (${m.graded}/${m.cases} cases ran)`,
    `false positive rate   ${m.false_positive_rate}%`,
    `false negative rate   ${m.false_negative_rate}%`,
    `wrong skill rate      ${m.wrong_skill_rate}%`,
  ].join('\n');
}

function renderBehavior(o) {
  return [`${o.suite} v${o.version} — ${o.cases.length} cases, graded manually`, '',
    ...o.cases.map((c) => `  ${c.id}  [${c.level}]  ${c.checks} checks  ${c.scenario}` +
      (c.mechanically_enforced_by ? `\n         enforced by: ${c.mechanically_enforced_by}` : '')),
    '', o.note].join('\n');
}

if (require.main === module) main();
