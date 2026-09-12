#!/usr/bin/env node
'use strict';
/**
 * make-screenshots.js — real screenshots of the extension library, for the docs.
 *
 * These are photographs of the actual UI, not drawings of it: the page, the
 * CSS and the markdown renderer are the shipped files, and the data comes from
 * a real `.attic/` written by the real `attic.js`. If the library breaks, these
 * break with it, which is the point — a hand-drawn mock would keep looking
 * correct forever.
 *
 * Playwright is a devDependency, so `npm test` still needs no install. Only
 * regenerating screenshots does:
 *
 *   npm install && npx playwright install chromium
 *   npm run screenshots
 *
 * Three things make this work outside a real extension context:
 *
 *  1. `chrome.*` does not exist on a plain page, so a small stub provides the
 *     storage, tabs and scripting calls library.js uses.
 *  2. The companion refuses a non-extension Origin (by design — a web page must
 *     not be able to drive the writer), so the harness server strips the Origin
 *     header before delegating to the real request handler. The check itself is
 *     never relaxed.
 *  3. A browser page cannot reach 127.0.0.1 from a different origin under some
 *     browsers' protections, so the harness serves the page AND the API from
 *     one origin.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'assets', 'screenshots');

const attic = require(path.join(ROOT, 'skills', 'attic', 'scripts', 'attic.js'));
const server = require(path.join(EXT, 'server', 'server.js'));

// A viewport wide enough for all three panes plus the outline rail, which is
// what the docs are meant to show.
//
// SCALE is 1.5, not 2: GitHub renders these at roughly 850px wide, so 2x was
// paying ~4.5MB of repo for detail no reader sees. 1.5x still looks crisp on a
// HiDPI display and costs less than half that.
const VIEWPORT = { width: 1380, height: 860 };
const SCALE = 1.5;

// ---------------------------------------------------------------------------
// A believable attic. Written through cmdStash, so the frontmatter, slugs,
// index lines and hook truncation are whatever the real CLI produces.
// ---------------------------------------------------------------------------
const ITEMS = [
  {
    slug: 'redis-eviction-sessions', kind: 'note', tags: 'redis, sessions',
    title: 'Redis eviction and sessions',
    hook: 'allkeys-lru evicts session keys, which have no TTL',
    body: `Source: https://redis.io/docs/reference/eviction

## Why sessions vanish

\`maxmemory-policy\` defaults to \`noeviction\`, but ours is set to
\`allkeys-lru\`, which evicts **any** key — including session keys, which we
store without a TTL.

So under memory pressure Redis picks session keys as eviction candidates and
users are logged out at random.

| policy | evicts | safe for sessions |
|---|---|---|
| noeviction | nothing | yes, but writes fail |
| allkeys-lru | any key | no |
| volatile-lru | keys with a TTL | yes |

\`\`\`
maxmemory-policy volatile-lru
\`\`\`

Related: [[cache-no-ttl]] is the same mistake in the cache layer.`,
  },
  {
    slug: 'cache-no-ttl', kind: 'finding', tags: 'cache, perf',
    title: 'The cache never expires anything',
    hook: 'get() never checks the stored timestamp, so there is no TTL',
    body: `\`get()\` reads \`store.get(key)\` and returns \`entry.value\` without ever
looking at \`entry.at\`.

- the timestamp is written on \`set()\`
- nothing reads it back
- so an entry is served forever

Fix: compare \`Date.now() - entry.at\` against the TTL in \`get()\`.

Same shape as [[redis-eviction-sessions]].`,
  },
  {
    slug: 'auth-token-refresh', kind: 'decision', tags: 'auth',
    title: 'Refresh tokens on 401, not on a timer',
    hook: 'a timer drifts against the server clock; a 401 is ground truth',
    decisionWhy: 'a timer drifts against the server clock, a 401 does not',
    body: `A refresh timer has to guess the expiry, and the guess drifts against
the server's clock.

- [x] refresh on a 401, retry the original request once
- [x] single-flight, so ten parallel 401s cause one refresh
- [ ] revisit if we ever need pre-emptive refresh for long uploads

See [[redis-eviction-sessions]] for the other reason users get logged out.`,
  },
  {
    slug: 'why-we-dropped-sse', kind: 'decision', tags: 'transport',
    title: 'Why we dropped SSE for polling',
    hook: 'corporate proxies buffered the stream; polling was honest about latency',
    decisionWhy: 'proxies buffered the stream and it looked like a hang',
    body: `SSE worked everywhere we tested and failed at two customers, both
behind proxies that buffer responses. A buffered stream looks exactly like a
hang.

Polling every 3s is worse on paper and better in practice: the latency is
visible, bounded, and the same for everyone.`,
  },
  {
    slug: 'benchmark-design', kind: 'plan', tags: 'benchmark',
    title: 'Benchmark design',
    hook: '3 sessions x 2 arms; rediscovery computed from transcripts, not judged',
    body: `Three sessions, two arms, same task.

1. arm A — attic on
2. arm B — attic off

Rediscovery is **computed**, not judged: count the files a session reads that an
earlier session already read.`,
  },
  {
    slug: 'flaky-ci-dns', kind: 'finding', tags: 'ci',
    title: 'The flaky CI job was DNS',
    hook: 'the runner resolved the registry through a cache with a 30s TTL',
    body: `Not the test. The runner resolved the package registry through a
cache with a 30s TTL, so one in twenty jobs got a stale record and timed out.`,
  },
  {
    slug: 'postgres-index-scan', kind: 'finding', tags: 'perf, postgres',
    title: 'The query planner stopped using the index',
    hook: 'stats went stale after the bulk import; ANALYZE fixed it',
    body: `After the bulk import the planner switched to a sequential scan.

The table statistics were stale, so the planner believed the table was small.
\`ANALYZE\` restored the index scan.`,
  },
];

function seedAttic() {
  // The library prints the project root in its status bar, so the last path
  // segment ends up in every screenshot. A mkdtemp name would put
  // "attic-shots-xliWWK" in the docs; nest a plausible project name instead.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-shots-'));
  const dir = path.join(tmp, 'acme-api');
  fs.mkdirSync(dir, { recursive: true });
  for (const it of ITEMS) {
    const r = attic.cmdStash(dir, {
      slug: it.slug, title: it.title, kind: it.kind,
      hook: it.hook, tags: it.tags, body: it.body,
      'decision-why': it.decisionWhy,
    });
    if (!r.ok) throw new Error(`seed failed for ${it.slug}: ${r.error}`);
  }
  // One pinned item, so the sidebar's Pinned count is not zero.
  attic.cmdPin(dir, { _: ['redis-eviction-sessions'] });
  return dir;
}

// ---------------------------------------------------------------------------
// One origin for the page and the API.
// ---------------------------------------------------------------------------
const API = ['/ping', '/items', '/index', '/recall', '/stash', '/decisions',
  '/validate', '/item', '/archive', '/pin'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function startHarness(root, token) {
  // Filled in once the server is listening. api.js builds its base URL as
  // `http://127.0.0.1:<port>`, so handing it OUR port is what makes every call
  // same-origin — which is the whole reason this harness exists.
  let port = 0;
  const stub = () => `
const STORE = { port: ${port}, token: ${JSON.stringify(token)}, root: ${JSON.stringify(root)},
                roots: [${JSON.stringify(root)}], theme: 'system' };
window.chrome = {
  storage: { local: {
    get: (keys) => {
      const k = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys || {}));
      const out = {}; for (const x of k) if (x in STORE) out[x] = STORE[x];
      return Promise.resolve(out);
    },
    set: (o) => { Object.assign(STORE, o); return Promise.resolve(); },
  }},
  tabs: { query: () => Promise.resolve([
    { id: 1, url: 'https://redis.io/docs/reference/eviction', title: 'Key eviction | Docs', lastAccessed: 2 },
  ]) },
  scripting: { executeScript: () => Promise.resolve([{ result:
    'allkeys-lru evicts any key, including ones with no TTL. If you store sessions in the same instance as your cache, session keys become eviction candidates and users are logged out at random.' }]) },
};`;

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (API.includes(u.pathname)) {
      // The origin check is doing its job by refusing us; strip the header
      // rather than weakening the check itself.
      delete req.headers.origin;
      req.headers['x-attic-token'] = token;
      if (!u.searchParams.get('root')) {
        u.searchParams.set('root', root);
        req.url = u.pathname + '?' + u.searchParams;
      }
      return server.handle(req, res, {
        roots: [root], token, version: 'screenshots', pairing: false, pairUntil: 0,
      }).catch((e) => { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); });
    }
    if (u.pathname === '/stub.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(stub());
    }
    const name = u.pathname === '/' ? 'library.html' : u.pathname.slice(1);
    const file = path.join(EXT, name);
    // Never serve outside extension/.
    if (!file.startsWith(EXT)) { res.writeHead(403); return res.end('no'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      if (name === 'library.html') {
        buf = Buffer.from(String(buf).replace(
          '<script type="module" src="library.js"></script>',
          '<script src="stub.js"></script>\n<script type="module" src="library.js"></script>'));
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    port = srv.address().port;
    resolve(srv);
  }));
}

// ---------------------------------------------------------------------------
async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    console.error('playwright is not installed. Screenshots are optional:');
    console.error('  npm install && npx playwright install chromium');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const root = seedAttic();
  const token = server.loadToken();
  const srv = await startHarness(root, token);
  const base = `http://127.0.0.1:${srv.address().port}`;

  const browser = await chromium.launch();
  const shots = [];

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    const fails = [];
    page.on('pageerror', (e) => fails.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') fails.push(m.text()); });

    // Cosmetic only: the temp root is displayed verbatim in the status bar and
    // the overview heading, and "/var/folders/cf/q84r…/attic-shots-ZPMUOV" is
    // noise in a doc. Rewrite the DISPLAYED string, never the root the API is
    // actually called with — the screenshots stay pictures of real behaviour.
    await page.addInitScript((real) => {
      const PRETTY = '~/code/acme-api';
      const fix = (n) => {
        if (n.nodeType === 3) {
          if (n.nodeValue.includes(real)) n.nodeValue = n.nodeValue.split(real).join(PRETTY);
          return;
        }
        if (n.nodeType === 1) for (const c of n.childNodes) fix(c);
      };
      // addInitScript runs before documentElement exists, so wait for it.
      const start = () => new MutationObserver(() => fix(document.body))
        .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    }, root);

    await page.goto(base + '/library.html');
    // The app is up once the list has painted. A fixed sleep would either be
    // flaky or slow; this is the actual condition.
    try {
      await page.waitForSelector('.card', { timeout: 15000 });
    } catch (e) {
      // A timeout here means the library never got its data. Report what the
      // page actually says rather than just "selector not found".
      const state = await page.evaluate(() => ({
        appHidden: document.getElementById('app') && document.getElementById('app').hidden,
        setupMsg: document.getElementById('setup-msg') && document.getElementById('setup-msg').textContent,
        list: (document.getElementById('list') || {}).innerHTML,
      }));
      console.error('the library never rendered a card. page state:');
      console.error(JSON.stringify(state, null, 2));
      if (fails.length) console.error('page errors:\n  ' + fails.join('\n  '));
      throw e;
    }
    await page.waitForFunction(() => !document.getElementById('app').hidden);

    const suffix = theme === 'dark' ? '' : '-light';
    const shot = async (name, fn) => {
      if (fn) await fn(page);
      // Let any entrance animation settle, so nothing is caught mid-fade.
      await page.waitForTimeout(450);
      const file = path.join(OUT, `${name}${suffix}.png`);
      await page.screenshot({ path: file });
      shots.push(path.relative(ROOT, file));
    };

    // 1. Reading an item: markdown, the outline rail, backlinks.
    await shot('library', async (p) => {
      await p.evaluate(() => {
        const c = [...document.querySelectorAll('.card .slug')]
          .find((x) => x.textContent === 'redis-eviction-sessions');
        if (c) c.closest('.card').click();
      });
    });

    // 2. Full-body search with the match highlighted.
    await shot('search', async (p) => {
      await p.fill('#q', 'evict');
      await p.waitForTimeout(250);
    });

    // 3. The command palette.
    await shot('palette', async (p) => {
      await p.fill('#q', '');
      await p.waitForTimeout(200);
      await p.keyboard.press('Meta+k');
      await p.waitForSelector('#palette:not([hidden])');
    });

    // 4. The overview.
    await shot('overview', async (p) => {
      await p.keyboard.press('Escape');
      await p.click('.nav[data-view="all"]');
      await p.evaluate(() => {
        const b = [...document.querySelectorAll('.p-row, .nav')].find((x) => /All items/.test(x.textContent));
        if (b) b.click();
      });
      await p.keyboard.press('g');
      await p.keyboard.press('h');
      await p.waitForSelector('.stats');
    });

    // 5. The link graph.
    await shot('links', async (p) => {
      await p.click('.nav[data-view="graph"]');
      await p.waitForTimeout(200);
    });

    // 6. Editing an item in place.
    await shot('editor', async (p) => {
      await p.click('.nav[data-view="all"]');
      await p.evaluate(() => {
        const c = [...document.querySelectorAll('.card .slug')]
          .find((x) => x.textContent === 'auth-token-refresh');
        if (c) c.closest('.card').click();
      });
      await p.waitForSelector('#a-edit');
      await p.click('#a-edit');
      await p.waitForSelector('#clip-form:not([hidden])');
    });

    if (fails.length) {
      console.error(`\npage errors in the ${theme} run:`);
      for (const f of fails) console.error('  ' + f);
      throw new Error('the library logged errors; screenshots would be of a broken UI');
    }
    await ctx.close();
  }

  await browser.close();
  srv.close();
  fs.rmSync(path.dirname(root), { recursive: true, force: true });

  for (const s of shots) {
    const kb = Math.round(fs.statSync(path.join(ROOT, s)).size / 1024);
    console.log(`${s}  (${kb}KB)`);
  }
  console.log(`\n${shots.length} screenshots in assets/screenshots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
