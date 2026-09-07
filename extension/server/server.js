#!/usr/bin/env node
'use strict';
/**
 * attic-serve — a localhost bridge between the Chrome extension and .attic/.
 *
 * The extension cannot write files, so this process does it. Everything
 * mechanical is delegated to skills/attic/scripts/attic.js: this file owns
 * only transport and trust. If you find yourself formatting frontmatter or
 * scanning for secrets here, you are duplicating the CLI and it will drift.
 *
 * Usage:
 *   node extension/server/server.js --root <project> [--root <project2>] [--port 8787]
 *
 * The server binds 127.0.0.1 only and requires a token that is printed on
 * first run and pasted into the extension's options page.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const attic = require(path.join(__dirname, '..', '..', 'skills', 'attic', 'scripts', 'attic.js'));

const DEFAULT_PORT = 8787;
const TOKEN_FILE = path.join(os.homedir(), '.attic-extension-token');
const MAX_BODY = 1024 * 1024; // a clip is text; a megabyte is already generous

// ---------- token ----------
// Persisted so the token survives restarts: otherwise every restart would
// silently break an extension that still holds the old one.
function loadToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch (e) { /* first run */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}

// Compare in constant time so the token cannot be recovered by timing.
function tokenOk(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- roots ----------
// A request names a project by path. Only paths the user passed on the command
// line are writable, so a compromised page cannot aim the writer at ~/.ssh.
function normaliseRoot(p) {
  return path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
}

function rootAllowed(roots, candidate) {
  if (!candidate) return roots[0] || null;
  const want = normaliseRoot(candidate);
  return roots.find((r) => r === want) || null;
}

// ---------- http helpers ----------
function send(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'content-type, x-attic-token';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Only the extension may call us. A web page carries its own site origin, so
// checking this keeps any random tab from driving the writer.
function originOk(origin) {
  if (!origin) return true; // curl and same-process callers send none
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

// ---------- routes ----------
async function handle(req, res, ctx) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const origin = req.headers.origin;

  if (!originOk(origin)) return send(res, 403, { ok: false, error: 'origin not allowed' });
  const allowOrigin = origin && origin.startsWith('chrome-extension://') ? origin : null;

  if (req.method === 'OPTIONS') return send(res, 204, {}, allowOrigin);

  // Unauthenticated: lets the popup show "companion running, token wrong"
  // rather than a bare connection failure.
  if (url.pathname === '/ping') {
    return send(res, 200, { ok: true, service: 'attic', version: ctx.version, roots: ctx.roots }, allowOrigin);
  }

  if (!tokenOk(req.headers['x-attic-token'], ctx.token)) {
    return send(res, 401, { ok: false, error: 'bad or missing token' }, allowOrigin);
  }

  const body = req.method === 'POST' ? await readBody(req) : {};
  const cwd = rootAllowed(ctx.roots, body.root || url.searchParams.get('root'));
  if (!cwd) return send(res, 403, { ok: false, error: 'project root not allowed' }, allowOrigin);

  if (url.pathname === '/index' && req.method === 'GET') {
    const limit = url.searchParams.get('limit');
    const r = attic.cmdIndex(cwd, limit ? { limit } : {});
    return send(res, r.ok ? 200 : 404, r, allowOrigin);
  }

  if (url.pathname === '/recall' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const r = attic.cmdRecall(cwd, q);
    return send(res, r.ok ? 200 : 404, r, allowOrigin);
  }

  if (url.pathname === '/stash' && req.method === 'POST') {
    const r = attic.cmdStash(cwd, {
      slug: body.slug,
      title: body.title,
      kind: body.kind || 'note',
      hook: body.hook,
      tags: body.tags,
      body: body.body,
      'decision-why': body.decisionWhy,
      // --force is deliberately not forwarded: a refusal from the secret scan
      // must be resolved by editing the clip, never by a flag from the browser.
    });
    // 422 keeps a refusal (a credential in the clip) distinct from a failure.
    const status = r.ok ? 200 : (r.refused ? 422 : 400);
    return send(res, status, r, allowOrigin);
  }

  return send(res, 404, { ok: false, error: 'no such endpoint' }, allowOrigin);
}

// ---------- main ----------
function parseArgv(argv) {
  const out = { roots: [], port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.roots.push(argv[++i]);
    else if (argv[i] === '--port') out.port = parseInt(argv[++i], 10);
  }
  return out;
}

function start(opts) {
  const roots = (opts.roots.length ? opts.roots : [process.cwd()]).map(normaliseRoot);
  for (const r of roots) {
    if (!fs.existsSync(r)) {
      process.stderr.write(`error: --root does not exist: ${r}\n`);
      process.exit(1);
    }
  }
  const ctx = { roots, token: loadToken(), version: require('../../package.json').version };
  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch((e) => send(res, 400, { ok: false, error: e.message }));
  });
  server.listen(opts.port, '127.0.0.1', () => {
    process.stdout.write(
      `attic companion on http://127.0.0.1:${opts.port}\n` +
      `roots:\n${roots.map((r) => '  ' + r).join('\n')}\n` +
      `token: ${ctx.token}\n  (also in ${TOKEN_FILE} — paste it into the extension options)\n`
    );
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') process.stderr.write(`error: port ${opts.port} is already in use. Pass --port to pick another.\n`);
    else process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  });
  return server;
}

if (require.main === module) start(parseArgv(process.argv.slice(2)));
module.exports = { start, normaliseRoot, rootAllowed, originOk, tokenOk, handle, loadToken };
