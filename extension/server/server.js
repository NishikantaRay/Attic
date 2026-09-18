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
 * The server binds 127.0.0.1 only and requires a token. To avoid making the
 * user copy 48 hex characters, the token is served from /ping during a pairing
 * window, and a closed window can always be reopened WITHOUT restarting:
 * pressing Enter in the companion's terminal works when there is one, and
 * `attic-serve --pair` (or touching the pair-request file) works when there is
 * not — both prove filesystem-level control of the machine. Pass --no-pair to
 * disable token serving entirely.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const attic = require(path.join(__dirname, '..', '..', 'skills', 'attic', 'scripts', 'attic.js'));

const DEFAULT_PORT = 8787;
const TOKEN_FILE = path.join(os.homedir(), '.attic-extension-token');
// Overridable so tests, and a second companion on another port, do not fight
// over one shared path: whoever polls first would eat everyone's requests.
const PAIR_REQUEST_FILE = process.env.ATTIC_PAIR_REQUEST_FILE
  || path.join(os.homedir(), '.attic-pair-request');
const MAX_BODY = 1024 * 1024; // a clip is text; a megabyte is already generous
const PAIR_WINDOW_MS = 5 * 60 * 1000;

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

// ---------- pairing ----------
// Handing the token to the extension removes the worst part of setup, but an
// unauthenticated /ping that serves it forever would widen the exposure for
// the whole life of the process. So the window is short and closes as soon as
// a client takes the token.
//
// It is deliberately REOPENABLE. A companion is left running for hours, so a
// window that only ever opened at startup meant "restart the server" was the
// answer to every pairing problem — which trains people to restart daemons to
// get past security prompts. Pressing Enter in the companion's own terminal
// reopens it, and that keystroke is the real proof of control: a process that
// cannot reach your TTY cannot trigger it.
function pairOpen(ctx) {
  if (!ctx.pairing) return false;
  return Date.now() < ctx.pairUntil;
}

function pairState(ctx) {
  if (!ctx.pairing) return 'disabled';
  return pairOpen(ctx) ? 'open' : 'closed';
}

function openPairWindow(ctx, why) {
  ctx.pairUntil = Date.now() + PAIR_WINDOW_MS;
  process.stdout.write(`pairing window open for ${PAIR_WINDOW_MS / 60000} min (${why}) — press Connect in the extension\n`);
}

// Two ways to ask for a window, because a companion is not always attached to
// a terminal. A keystroke proves control of the TTY; creating a file in $HOME
// proves control of the account. Both are things a web page cannot do.
function watchForReopen(ctx) {
  if (!ctx.pairing) return null;

  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', () => openPairWindow(ctx, 'requested from the terminal'));
  }

  // Backgrounded companions (and anything under a service manager) have no
  // keystroke available, so watch for a request file instead. Polling beats
  // fs.watch here: it survives the file being created, deleted and recreated.
  const timer = setInterval(() => {
    let st;
    try { st = fs.statSync(PAIR_REQUEST_FILE); } catch (e) { return; }
    try { fs.unlinkSync(PAIR_REQUEST_FILE); } catch (e) { /* best effort */ }
    if (Date.now() - st.mtimeMs < 60 * 1000) openPairWindow(ctx, 'requested via ' + PAIR_REQUEST_FILE);
  }, 1000);
  // Deliberately NOT unref'd. An unref'd timer is not guaranteed to be
  // scheduled, which silently disabled file-based pairing entirely; the
  // server's own listener is what keeps the process alive, and close()
  // clears this timer, so nothing is kept up longer than it should be.
  return timer;
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
    headers['access-control-allow-methods'] = 'GET, POST, PUT, OPTIONS';
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
    const state = pairState(ctx);
    const out = { ok: true, service: 'attic', version: ctx.version, roots: ctx.roots, pairing: state };
    // Only a deliberate pair request consumes the window: a plain status ping
    // from the popup must not burn it.
    if (url.searchParams.get('pair') === '1' && pairOpen(ctx)) {
      out.token = ctx.token;
      // The window is left open for the rest of its time box on purpose: see
      // the note above. Repeated pairs within it are expected, not an attack.
      if (!ctx.announcedPair) {
        ctx.announcedPair = true;
        process.stdout.write('paired with the extension\n');
      }
    }
    return send(res, 200, out, allowOrigin);
  }

  if (!tokenOk(req.headers['x-attic-token'], ctx.token)) {
    return send(res, 401, { ok: false, error: 'bad or missing token' }, allowOrigin);
  }

  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
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
      // Provenance from the browser is limited to what a page can honestly
      // supply: where it came from, and that it is a note. `confidence` is
      // NOT accepted from this path — a clipped article is evidence about a
      // web page, never a verified fact about the user's codebase, and
      // letting a caller assert otherwise would put an unearned `verified`
      // stamp on third-party prose. attic.js defaults it to `unverified`.
      type: body.type === 'workaround' || body.type === 'failed-approach' ? body.type : 'note',
      'source-url': body.sourceUrl,
      // --force is deliberately not forwarded: a refusal from the secret scan
      // must be resolved by editing the clip, never by a flag from the browser.
    });
    // 422 keeps a refusal (a credential in the clip) distinct from a failure.
    const status = r.ok ? 200 : (r.refused ? 422 : 400);
    return send(res, status, r, allowOrigin);
  }

  // ---- writes beyond /stash -------------------------------------------
  // Editing, archiving and pinning act only on a slug that already exists
  // inside an allowed root, so they reach nothing /stash could not already
  // reach. Every one of them delegates to attic.js: the secret scan, the hook
  // cap, the index bookkeeping and the atomic write are not reimplemented here.
  //
  // There is deliberately no delete. cmdArchive is a rename into
  // .attic/archive/ and restore is one call, so nothing the browser does is
  // unrecoverable; a localhost port that can unlink files is a worse trade.
  if (url.pathname === '/item' && req.method === 'PUT') {
    const r = attic.cmdEdit(cwd, {
      slug: body.slug,
      title: body.title,
      kind: body.kind,
      hook: body.hook,
      tags: body.tags,
      body: body.body,
      // --force is not forwarded, exactly as in /stash: a refused secret is
      // fixed by editing the text, never by a flag from the browser.
    });
    const status = r.ok ? 200 : (r.refused ? 422 : 400);
    return send(res, status, r, allowOrigin);
  }

  if (url.pathname === '/archive' && req.method === 'POST') {
    const r = attic.cmdArchive(cwd, { _: [], slug: body.slug, restore: !!body.restore });
    return send(res, r.ok ? 200 : 400, r, allowOrigin);
  }

  if (url.pathname === '/pin' && req.method === 'POST') {
    const r = attic.cmdPin(cwd, { _: [], slug: body.slug, unpin: !!body.unpin });
    return send(res, r.ok ? 200 : 400, r, allowOrigin);
  }

  // ---- reads ------------------------------------------------------------
  if (url.pathname === '/validate' && req.method === 'GET') {
    const r = attic.cmdValidate(cwd);
    return send(res, 200, r, allowOrigin);
  }

  // /index caps recentDecisions at 10; the decisions view wants all of them.
  if (url.pathname === '/decisions' && req.method === 'GET') {
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(cwd, '.attic', 'DECISIONS.md'), 'utf8')
        .split('\n').filter((l) => l.startsWith('- '));
    } catch (e) { /* none yet */ }
    return send(res, 200, { ok: true, decisions: lines }, allowOrigin);
  }

  // Every item at once, so the library can resolve [[wikilinks]], compute
  // backlinks and search bodies without N round trips on a big attic.
  if (url.pathname === '/items' && req.method === 'GET') {
    const idx = attic.cmdIndex(cwd, {});
    if (!idx.ok) return send(res, 404, idx, allowOrigin);
    const items = [];
    for (const e of idx.items) {
      const found = attic.findItem(cwd, e.slug);
      if (!found) continue;
      let parsed;
      try { parsed = attic.parseFrontmatter(fs.readFileSync(found.file, 'utf8')); }
      catch (err) { continue; }
      items.push({
        slug: e.slug, kind: e.kind, hook: e.hook,
        meta: parsed.meta, body: parsed.body.trim(),
        archived: found.archived,
      });
    }
    return send(res, 200, { ok: true, counts: idx.counts, items }, allowOrigin);
  }

  return send(res, 404, { ok: false, error: 'no such endpoint' }, allowOrigin);
}

// ---------- main ----------
// `attic-serve --pair` against an already-running companion: drop the request
// file and exit, rather than trying to bind a port that is already taken.
function requestPairing() {
  fs.writeFileSync(PAIR_REQUEST_FILE, String(Date.now()) + '\n', { mode: 0o600 });
  process.stdout.write('pairing requested — the running companion will reopen its window within a second.\n');
}

function parseArgv(argv) {
  const out = { roots: [], port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.roots.push(argv[++i]);
    else if (argv[i] === '--port') out.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--no-pair') out.pairing = false;
    else if (argv[i] === '--pair') out.pairRequest = true;
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
  const ctx = {
    roots,
    token: loadToken(),
    version: require('../../package.json').version,
    pairing: opts.pairing !== false,
    startedAt: Date.now(),
    pairUntil: opts.pairing === false ? 0 : Date.now() + PAIR_WINDOW_MS,
  };
  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch((e) => send(res, 400, { ok: false, error: e.message }));
  });
  server.listen(opts.port, '127.0.0.1', () => {
    process.stdout.write(
      `attic companion on http://127.0.0.1:${opts.port}\n` +
      `roots:\n${roots.map((r) => '  ' + r).join('\n')}\n` +
      (ctx.pairing
        ? `pairing: open for ${PAIR_WINDOW_MS / 60000} min — open the extension and click Connect\n` +
          `         to reopen later: press Enter here, or run\n` +
          `         node ${path.relative(process.cwd(), __filename)} --pair\n`
        : `pairing: disabled (--no-pair)\n`) +
      `token: ${ctx.token}\n  (also in ${TOKEN_FILE} — only needed if you pair by hand)\n`
    );
  });
  // Exposed so a caller (and the tests) can reopen pairing programmatically.
  server.atticCtx = ctx;
  const pairTimer = watchForReopen(ctx);
  // A closed server must stop competing for the pair-request file; otherwise
  // every companion ever started in this process keeps eating requests.
  server.on('close', () => { if (pairTimer) clearInterval(pairTimer); });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') process.stderr.write(`error: port ${opts.port} is already in use. Pass --port to pick another.\n`);
    else process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  });
  return server;
}

if (require.main === module) {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.pairRequest) requestPairing();
  else start(opts);
}
module.exports = { start, normaliseRoot, rootAllowed, originOk, tokenOk, handle, loadToken, pairOpen, pairState, openPairWindow, requestPairing, PAIR_REQUEST_FILE, PAIR_WINDOW_MS };
