#!/usr/bin/env node
'use strict';
/**
 * Attic benchmark: authentication investigation.
 *
 * Three sessions per arm against a fresh copy of a real repository. The arms
 * differ in exactly one thing: whether the Attic plugin is loaded. Prompts,
 * repo, model and order are identical.
 *
 *   node benchmarks/auth-investigation/run.js --repo ~/path/to/repo
 *   node benchmarks/auth-investigation/run.js --repo ... --arm attic
 *
 * Writes per-session transcripts and results.json under baseline/ and attic/.
 * Does not grade correctness: that is read off the diffs against the rubric.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const HERE = __dirname;
const PLUGIN_ROOT = path.join(HERE, '..', '..');

function findClaude() {
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

// The three prompts, verbatim from task.md.
const PROMPTS = {
  1: `You are investigating an unfamiliar codebase.

Your task is to understand how authentication works in this repository.

Do not modify any files or write implementation code.

Investigate the repository deeply enough to answer:

Where does authentication begin?
What is the complete authentication flow from request to authenticated user?
Which files/functions are responsible for each important step?
Where is authentication state stored?
How are sessions/tokens/cookies handled?
What middleware, guards, or authorization checks are involved?
What are the important security assumptions?
What surprising, non-obvious, or easy-to-miss behavior did you discover?
If you had to modify authentication tomorrow, which files would you need to understand first?

Explore the actual code. Do not rely on filenames or assumptions.

At the end, produce a concise investigation report containing:

Authentication flow
Important files
Important functions
Data/state involved
Security considerations
Non-obvious discoveries
Things that would be easy for another developer/agent to get wrong

Do not make changes to the repository.`,

  2: `You need to make a change to the authentication system in this repository.

Before making changes, understand the existing authentication implementation well enough to avoid breaking its current behavior.

The task is:

Add an account lockout mechanism after 5 consecutive failed login attempts.

Requirements:

After 5 consecutive failed login attempts, the account must be temporarily locked.
Successful authentication should reset the failed-attempt counter.
Existing authenticated users and sessions must continue to work.
Do not introduce a new authentication mechanism.
Follow the repository's existing architecture and conventions.
Handle the behavior consistently with the existing authentication flow.
Add or update tests where appropriate.

First investigate the existing authentication implementation.

Then implement the change.

At the end, explain:

Which authentication files you modified.
How the existing authentication flow works.
Where the lockout logic was integrated and why.
What tests you added or changed.
Any assumptions you had to make.`,

  3: `You need to make another change to the authentication system in this repository.

The task is:

Allow a signed-in user to change their password.

Requirements:

The user must supply their current password to set a new one.
The new password must meet the same rules the system already enforces at signup.
Existing authenticated users and sessions must continue to work.
Follow the repository's existing architecture and conventions.
Add or update tests where appropriate.

First investigate the existing authentication implementation.

Then implement the change.

At the end, explain:

Which authentication files you modified.
How the existing authentication flow works.
Where the change was integrated and why.
What tests you added or changed.
Any assumptions you had to make.`,
};

function copyRepo(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  // Skip node_modules and .git: the agent should read source, and a copied
  // .git would let it diff its way to the answer.
  spawnSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git',
    src.replace(/\/?$/, '/'), dst], { stdio: 'ignore' });
}

function runSession(bin, repo, prompt, useAttic) {
  const args = ['-p', prompt, '--output-format', 'json',
    '--max-turns', '60', '--permission-mode', 'acceptEdits'];
  if (useAttic) args.unshift('--plugin-dir', PLUGIN_ROOT);
  const env = Object.assign({}, process.env);
  if (!useAttic) env.ATTIC_DEFAULT_MODE = 'off';

  const started = Date.now();
  const res = spawnSync(bin, args, {
    cwd: repo, encoding: 'utf8', timeout: 30 * 60 * 1000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 200 * 1024 * 1024, env,
  });
  const wall = Date.now() - started;

  let p = null;
  try { p = JSON.parse(res.stdout); } catch (e) { /* fall through */ }
  if (!p) return { error: (res.stderr || '').slice(0, 400) || `exit ${res.status}`, wallMs: wall };

  const u = p.usage || {};
  return {
    text: p.result || '',
    inputTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    outputTokens: u.output_tokens || 0,
    turns: p.num_turns || 0,
    costUsd: p.total_cost_usd || 0,
    durationMs: p.duration_ms || wall,
    wallMs: wall,
    sessionId: p.session_id || null,
  };
}

/**
 * Rediscovery: how much of session 2 and 3's file access repeats what session
 * 1 already read. Computed from the transcript, not judged.
 */
function readTranscript(projectDir, sessionId) {
  // Two traps here, both of which silently yield zero tool calls rather than
  // an error: on macOS os.tmpdir() is /var/... while the CLI slugs the
  // realpath (/private/var/...), and the slug replaces underscores as well
  // as slashes and dots. Getting either wrong makes the headline metric read
  // as a finding when it is really a measurement failure.
  const candidates = new Set();
  for (const base of [projectDir, (() => { try { return fs.realpathSync(projectDir); } catch (e) { return projectDir; } })()]) {
    candidates.add(path.resolve(base).replace(/[/._]/g, '-'));
  }
  for (const slug of candidates) {
    const f = path.join(os.homedir(), '.claude', 'projects', slug, sessionId + '.jsonl');
    try {
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { /* try the next candidate */ }
  }
  return [];
}

function toolUse(rows) {
  const calls = [];
  for (const r of rows) {
    const content = r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === 'tool_use') calls.push({ name: c.name, input: c.input || {} });
    }
  }
  return calls;
}

// Which files did a session actually open or search?
function filesTouched(calls, repo) {
  const files = new Set();
  for (const c of calls) {
    const p = c.input.file_path || c.input.path || c.input.notebook_path;
    if (p) {
      // Absolute paths from one arm must normalise to the same repo-relative
      // form as the other, or the two sets can never intersect.
      const rel = path.relative(repo, path.resolve(repo, p));
      files.add(rel.replace(/^(\.\.\/)+/, '').replace(/^.*attic-bench-[a-z]+-\d+\//, ''));
    }
    // Bash reads count too: cat/head/sed/grep against a path.
    if (c.name === 'Bash' && typeof c.input.command === 'string') {
      for (const m of c.input.command.matchAll(/(?:^|[\s"'])((?:\.\/)?[\w./-]+\.(?:js|ts|json|md))/g)) {
        files.add(m[1].replace(/^\.\//, ''));
      }
    }
  }
  return files;
}

function main() {
  const argv = process.argv.slice(2); const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2), n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; } }
  }
  const srcRepo = args.repo && path.resolve(args.repo.replace(/^~/, os.homedir()));
  if (!srcRepo || !fs.existsSync(srcRepo)) {
    process.stderr.write('usage: run.js --repo <path> [--arm baseline|attic]\n'); process.exit(2);
  }
  const bin = findClaude();
  if (!bin) { process.stderr.write('no claude binary found\n'); process.exit(2); }

  const arms = args.arm ? [args.arm] : ['baseline', 'attic'];
  for (const arm of arms) {
    const useAttic = arm === 'attic';
    const outDir = path.join(HERE, arm);
    fs.mkdirSync(outDir, { recursive: true });
    const work = path.join(fs.realpathSync(os.tmpdir()), `attic-bench-${arm}-${Date.now()}`);
    copyRepo(srcRepo, work);
    process.stderr.write(`\n=== ${arm} : ${work}\n`);

    const sessions = [];
    for (const n of [1, 2, 3]) {
      process.stderr.write(`  session ${n}...\n`);
      const r = runSession(bin, work, PROMPTS[n], useAttic);
      r.session = n;
      if (r.sessionId) {
        const rows = readTranscript(work, r.sessionId);
        const calls = toolUse(rows);
        r.toolCalls = calls.length;
        r.toolBreakdown = calls.reduce((a, c) => { a[c.name] = (a[c.name] || 0) + 1; return a; }, {});
        r.files = [...filesTouched(calls, work)].sort();
      }
      fs.writeFileSync(path.join(outDir, `session-${n}.md`), r.text || `ERROR: ${r.error}`);
      sessions.push(r);
      if (r.error) process.stderr.write(`  session ${n} ERROR: ${r.error}\n`);
    }

    // Rediscovery: files session 1 read that 2 or 3 read again.
    const s1 = new Set(((sessions[0] && sessions[0].files) || []).filter((f) => !f.startsWith('.attic/')));
    const reread = {};
    for (const n of [1, 2]) {
      const s = sessions[n];
      if (!s || !s.files) continue;
      // Reading .attic/ is the mechanism, not rediscovery — counting it would
    // penalise the arm for using the thing being measured.
    reread[`session${n + 1}`] = s.files.filter((f) => s1.has(f) && !f.startsWith('.attic/'));
    }

    const diff = spawnSync('git', ['-C', work, 'diff'], { encoding: 'utf8' });
    if (!diff.stdout) {
      // no .git in the copy; diff against the source instead
      const d = spawnSync('diff', ['-ru', '--exclude=node_modules', '--exclude=.git', '--exclude=.attic', srcRepo, work], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      fs.writeFileSync(path.join(outDir, 'changes.diff'), d.stdout || '(no changes)');
    } else {
      fs.writeFileSync(path.join(outDir, 'changes.diff'), diff.stdout);
    }

    const atticState = useAttic && fs.existsSync(path.join(work, '.attic'))
      ? { items: fs.readdirSync(path.join(work, '.attic', 'items')).length,
          index: fs.readFileSync(path.join(work, '.attic', 'INDEX.md'), 'utf8') }
      : null;

    const totals = sessions.reduce((a, s) => ({
      input: a.input + (s.inputTokens || 0), output: a.output + (s.outputTokens || 0),
      tools: a.tools + (s.toolCalls || 0), wallMs: a.wallMs + (s.wallMs || 0),
      cost: a.cost + (s.costUsd || 0),
    }), { input: 0, output: 0, tools: 0, wallMs: 0, cost: 0 });

    const report = { arm, date: new Date().toISOString(), repo: srcRepo, workdir: work,
      binary: '<redacted>', totals, sessions, rediscovery: reread, attic: atticState };
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`  totals: ${totals.input.toLocaleString()} in, ${totals.tools} tool calls, ${(totals.wallMs / 1000).toFixed(0)}s\n`);
  }
  process.stderr.write('\ndone. Compare with: node benchmarks/auth-investigation/report.js\n');
}

if (require.main === module) main();
