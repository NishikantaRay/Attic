'use strict';
// The companion writes to disk on behalf of a browser, so these tests care
// about two things: that it delegates to attic.js rather than reimplementing
// it, and that it refuses everything it should.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'extension', 'server', 'server.js');
const srv = require(SERVER);

function proj() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-ext-'));
  return fs.realpathSync(d); // macOS /var -> /private/var, as normaliseRoot resolves
}

// Boot on an ephemeral port so tests never collide with a running companion.
function boot(roots) {
  const server = srv.start({ roots, port: 0 });
  return new Promise((resolve) => {
    server.on('listening', () => resolve({ server, port: server.address().port }));
  });
}

const TOKEN = srv.loadToken();

async function req(port, pathname, { method = 'GET', body, token = TOKEN, origin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers['x-attic-token'] = token;
  if (origin) headers.origin = origin;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

test('stash writes a real item through attic.js', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  const r = await req(port, '/stash', {
    method: 'POST',
    body: { root: cwd, slug: 'clipped-page', kind: 'note', title: 'Clipped page',
            hook: 'a hook', body: 'Source: https://example.com\n\nSome text.' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  const file = path.join(cwd, '.attic', 'items', 'clipped-page.md');
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /^---\n/);            // frontmatter came from renderItem
  assert.match(raw, /title: Clipped page/);
  assert.match(raw, /https:\/\/example\.com/);
  const index = fs.readFileSync(path.join(cwd, '.attic', 'INDEX.md'), 'utf8');
  assert.match(index, /- \[clipped-page\]\(items\/clipped-page\.md\) · note · a hook/);
});

test('the secret scan refuses a clip and writes nothing', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  const r = await req(port, '/stash', {
    method: 'POST',
    body: { root: cwd, slug: 'leaky', kind: 'note', title: 'Leaky',
            hook: 'h', body: 'The page showed AKIAIOSFODNN7EXAMPLE in a config sample.' },
  });
  assert.equal(r.status, 422, 'a refusal is not a generic 400');
  assert.equal(r.json.refused, true);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'leaky.md')), false);
});

test('--force cannot be smuggled in from the browser', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  const r = await req(port, '/stash', {
    method: 'POST',
    body: { root: cwd, slug: 'leaky2', kind: 'note', title: 'Leaky2', hook: 'h',
            force: true, body: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' },
  });
  assert.equal(r.status, 422);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'leaky2.md')), false);
});

test('a bad token is rejected and a missing one too', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  assert.equal((await req(port, '/index', { token: 'x'.repeat(48) })).status, 401);
  assert.equal((await req(port, '/index', { token: null })).status, 401);
});

test('a root outside the allowlist is refused', async (t) => {
  const allowed = proj();
  const other = proj();
  const { server, port } = await boot([allowed]);
  t.after(() => server.close());

  const r = await req(port, '/stash', {
    method: 'POST',
    body: { root: other, slug: 'nope', kind: 'note', title: 'Nope', hook: 'h', body: 'x' },
  });
  assert.equal(r.status, 403);
  assert.equal(fs.existsSync(path.join(other, '.attic')), false);
});

test('a web page origin cannot drive the writer', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  const r = await req(port, '/stash', {
    origin: 'https://evil.example',
    method: 'POST',
    body: { root: cwd, slug: 'evil', kind: 'note', title: 'Evil', hook: 'h', body: 'x' },
  });
  assert.equal(r.status, 403);
  assert.equal(fs.existsSync(path.join(cwd, '.attic', 'items', 'evil.md')), false);
});

test('ping needs no token, so the popup can tell "down" from "wrong token"', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());
  const r = await req(port, '/ping', { token: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('index and recall read back what stash wrote', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());

  await req(port, '/stash', {
    method: 'POST',
    body: { root: cwd, slug: 'read-back', kind: 'finding', title: 'Read back',
            hook: 'proves the loop', body: 'The body we expect to see again.' },
  });
  const idx = await req(port, `/index?root=${encodeURIComponent(cwd)}`);
  assert.equal(idx.json.counts.items, 1);
  assert.equal(idx.json.items[0].slug, 'read-back');

  const rec = await req(port, `/recall?root=${encodeURIComponent(cwd)}&q=read-back`);
  assert.match(rec.json.body, /The body we expect to see again\./);
});

test('an oversized body is rejected rather than buffered', async (t) => {
  const cwd = proj();
  const { server, port } = await boot([cwd]);
  t.after(() => server.close());
  const r = await req(port, '/stash', {
    method: 'POST',
    body: { root: cwd, slug: 'huge', kind: 'note', title: 'Huge', hook: 'h', body: 'x'.repeat(2 * 1024 * 1024) },
  }).catch((e) => ({ status: 0, json: { err: e.message } }));
  assert.notEqual(r.status, 200);
});

test('normaliseRoot expands ~ and resolves relative paths', () => {
  assert.equal(srv.normaliseRoot('~'), os.homedir());
  assert.equal(srv.normaliseRoot('~/x'), path.join(os.homedir(), 'x'));
  assert.ok(path.isAbsolute(srv.normaliseRoot('./rel')));
});

test('originOk accepts the extension and nothing else', () => {
  assert.equal(srv.originOk(undefined), true);
  assert.equal(srv.originOk('chrome-extension://' + 'a'.repeat(32)), true);
  assert.equal(srv.originOk('https://evil.example'), false);
  assert.equal(srv.originOk('chrome-extension://short'), false);
});
