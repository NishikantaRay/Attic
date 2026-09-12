'use strict';
/**
 * The write half of the companion: edit, pin, archive, and the read routes the
 * library needs (/items, /decisions, /validate).
 *
 * The point of these is not that the routes return 200. It is that the
 * dangerous properties hold: an edit REPLACES rather than appends, the secret
 * scan still refuses an edit, archive MOVES rather than unlinks, the root
 * allowlist covers the new routes, and there is no delete endpoint at all.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const server = require('../extension/server/server.js');
const attic = require('../skills/attic/scripts/attic.js');

// Port 0 lets the OS pick a free one. A hard-coded port makes the suite fail
// whenever anything else — another test file, a companion someone left
// running — happens to hold it, which is a fragile test rather than a real bug.
let PORT = 0;
let root, srv, token;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-write-'));
  attic.cmdStash(root, {
    slug: 'alpha', title: 'Alpha item', kind: 'finding', hook: 'first',
    body: '# Alpha\n\nLinks to [[beta]].', tags: 'x, y',
  });
  attic.cmdStash(root, {
    slug: 'beta', title: 'Beta item', kind: 'decision', hook: 'second',
    body: 'Beta body here.', tags: 'y',
  });
  token = server.loadToken();
  srv = server.start({ roots: [root], port: 0, pairing: false });
  await new Promise((resolve) => {
    if (srv.listening) return resolve();
    srv.once('listening', resolve);
  });
  PORT = srv.address().port;
});

after(() => {
  if (srv) srv.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function call(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify({ root, ...body }) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port: PORT, method,
        path: pathname + (pathname.includes('?') ? '&' : '?') + 'root=' + encodeURIComponent(root),
        headers: { 'x-attic-token': token, 'content-type': 'application/json' },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s || '{}') }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const read = (slug, archived) =>
  fs.readFileSync(path.join(root, '.attic', archived ? 'archive' : 'items', slug + '.md'), 'utf8');
const index = () => fs.readFileSync(path.join(root, '.attic', 'INDEX.md'), 'utf8');

// ---------- reads the library depends on ----------

test('/items returns every item with its body and parsed frontmatter', async () => {
  // The library resolves wikilinks, computes backlinks and searches text from
  // this one response; a recall per item was N round trips for the same bytes.
  const r = await call('GET', '/items');
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 2);
  assert.ok(r.body.items.every((i) => i.body.length > 0), 'every item must carry its body');
  const alpha = r.body.items.find((i) => i.slug === 'alpha');
  assert.deepEqual(alpha.meta.tags, ['x', 'y']);
});

test('/decisions and /validate answer', async () => {
  const d = await call('GET', '/decisions');
  assert.equal(d.body.ok, true);
  assert.ok(d.body.decisions.length >= 1, 'stashing a decision writes a DECISIONS.md line');

  const v = await call('GET', '/validate');
  assert.equal(v.body.ok, true);
  assert.deepEqual(v.body.problems, [], 'a freshly stashed attic is clean');
});

// ---------- the edit contract ----------

test('PUT /item replaces the body instead of appending an update', async () => {
  // This is the whole reason cmdEdit exists. cmdStash on an existing slug
  // appends "## Update <date>", which is right for an agent adding to a
  // finding and wrong for a person fixing one: an editor that appends on every
  // save turns one item into a pile of near-duplicates.
  const r = await call('PUT', '/item', {
    slug: 'alpha', title: 'Alpha renamed', kind: 'finding',
    hook: 'edited hook', body: 'Replaced body.', tags: 'z',
  });
  assert.equal(r.status, 200);
  const file = read('alpha');
  assert.ok(!file.includes('## Update'), 'an edit must not append a dated section');
  assert.ok(file.includes('Replaced body.'));
  assert.ok(file.includes('title: Alpha renamed'));
  assert.match(file, /tags: \[z\]/, 'an explicit tag list replaces rather than merges');
  assert.ok(index().includes('edited hook'), 'the index hook follows the edit');
});

test('an edit keeps the original date', async () => {
  // An item's date is when the thing was learned, not when a typo in it was
  // fixed. Rewriting it on every save would make "newest first" meaningless.
  attic.cmdStash(root, { slug: 'dated', title: 'Dated', kind: 'note', hook: 'h', body: 'original' });
  const before = read('dated').match(/date: (\S+)/)[1];
  const file = path.join(root, '.attic', 'items', 'dated.md');
  fs.writeFileSync(file, read('dated').replace(/date: \S+/, 'date: 2020-01-01'));
  await call('PUT', '/item', { slug: 'dated', body: 'edited later' });
  assert.match(read('dated'), /date: 2020-01-01/, 'the stored date must survive an edit');
  assert.ok(before);
});

test('the secret scan refuses an edit exactly as it refuses a stash', async () => {
  // Without this, "edit" is simply the way to smuggle a credential past the
  // check that guards "stash".
  const r = await call('PUT', '/item', { slug: 'beta', body: 'token = ghp_' + 'a'.repeat(36) });
  assert.equal(r.status, 422, 'a refusal is 422, distinct from a failure');
  assert.equal(r.body.refused, true);
  assert.ok(read('beta').includes('Beta body here.'), 'the refused edit must not have landed');
});

test('an edit cannot blank an item', async () => {
  const r = await call('PUT', '/item', { slug: 'beta', body: '   ' });
  assert.equal(r.status, 400);
  assert.ok(read('beta').includes('Beta body here.'));
});

test('editing an unknown slug fails rather than creating one', async () => {
  // Creation goes through /stash, which is where the kind defaulting and the
  // index line live. A PUT that silently created items would be a second,
  // subtly different create path.
  const r = await call('PUT', '/item', { slug: 'does-not-exist', body: 'hello' });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.ok(!fs.existsSync(path.join(root, '.attic', 'items', 'does-not-exist.md')));
});

// ---------- pin / archive ----------

test('POST /pin writes the frontmatter flag and unpins again', async () => {
  const on = await call('POST', '/pin', { slug: 'beta' });
  assert.equal(on.body.pinned, true);
  assert.ok(read('beta').includes('pinned: true'));

  const off = await call('POST', '/pin', { slug: 'beta', unpin: true });
  assert.equal(off.body.pinned, false);
  assert.ok(!read('beta').includes('pinned: true'));
});

test('archive moves the file and never unlinks it, and restore reverses that', async () => {
  // The reason the browser is allowed to archive at all: nothing it does is
  // unrecoverable. If this ever became an unlink, that argument is gone.
  const r = await call('POST', '/archive', { slug: 'beta' });
  assert.equal(r.body.ok, true);
  assert.ok(fs.existsSync(path.join(root, '.attic', 'archive', 'beta.md')), 'the file must be kept');
  assert.ok(!fs.existsSync(path.join(root, '.attic', 'items', 'beta.md')));
  assert.ok(!index().includes('beta'), 'an archived item leaves the index');

  const back = await call('POST', '/archive', { slug: 'beta', restore: true });
  assert.equal(back.body.ok, true);
  assert.ok(index().includes('beta'), 'a restored item rejoins the index');
});

test('editing an archived item does not resurrect it into the index', async () => {
  await call('POST', '/archive', { slug: 'alpha' });
  await call('PUT', '/item', { slug: 'alpha', body: 'edited while archived' });
  assert.ok(!index().includes('](items/alpha.md)'), 'an archived item must stay out of the index');
  assert.ok(read('alpha', true).includes('edited while archived'));
  await call('POST', '/archive', { slug: 'alpha', restore: true });
});

// ---------- trust boundary ----------

test('the root allowlist covers the new write routes', async () => {
  for (const [method, route] of [['PUT', '/item'], ['POST', '/archive'], ['POST', '/pin']]) {
    const r = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ root: '/etc', slug: 'alpha', body: 'nope' });
      const req = http.request(
        { host: '127.0.0.1', port: PORT, method, path: route, headers: { 'x-attic-token': token, 'content-type': 'application/json' } },
        (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode })); }
      );
      req.on('error', reject); req.write(data); req.end();
    });
    assert.equal(r.status, 403, `${method} ${route} must refuse a root outside the allowlist`);
  }
});

test('every write route still requires the token', async () => {
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method: 'PUT', path: '/item', headers: { 'content-type': 'application/json' } },
      (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode })); }
    );
    req.on('error', reject); req.write(JSON.stringify({ slug: 'alpha', body: 'x' })); req.end();
  });
  assert.equal(r.status, 401);
});

test('there is no delete endpoint', async () => {
  // Archive covers the intent and is reversible. A localhost port that can
  // unlink files is a worse trade, so the absence is deliberate and tested.
  for (const route of ['/delete', '/rm', '/item/delete']) {
    const r = await call('POST', route, { slug: 'alpha' });
    assert.equal(r.status, 404, `${route} must not exist`);
  }
  const del = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method: 'DELETE', path: '/item?root=' + encodeURIComponent(root), headers: { 'x-attic-token': token } },
      (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode })); }
    );
    req.on('error', reject); req.end();
  });
  assert.equal(del.status, 404, 'DELETE /item must not be routed');
});
