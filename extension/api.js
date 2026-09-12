'use strict';
/**
 * Shared client for the localhost companion. Imported by the popup, the
 * options page and the service worker, so the token/port handling lives once.
 */
const DEFAULTS = { port: 8787, token: '', root: '' };

// Nothing in setup may hang: a promise that never settles leaves the card on
// its loading text forever, which looks identical to a crash and is NOT caught
// by try/catch. Every await in this file is bounded.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function settings() {
  const stored = await withTimeout(chrome.storage.local.get(Object.keys(DEFAULTS)), 1500, {});
  return { ...DEFAULTS, ...(stored || {}) };
}

function base(s) { return `http://127.0.0.1:${s.port}`; }

// One shape for every failure the UI has to explain: a down companion, a bad
// token and a refused clip should not each need their own try/catch upstream.
async function call(pathname, { method = 'GET', body, params } = {}) {
  const s = await settings();
  const url = new URL(base(s) + pathname);
  if (params) for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  if (s.root && !url.searchParams.has('root')) url.searchParams.set('root', s.root);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-attic-token': s.token },
      body: body ? JSON.stringify({ root: s.root, ...body }) : undefined,
    });
  } catch (e) {
    return { ok: false, offline: true, error: `no companion on port ${s.port}. Start it with: npm run attic:serve` };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: `bad response (${res.status})` }; }
  if (res.status === 401) return { ok: false, error: 'token rejected — check the extension options' };
  if (res.status === 422) return { ...data, refused: true };
  return data;
}

// Ports to sweep when nothing is configured yet. Small and fixed: a real scan
// of 65k ports from an extension would look exactly like malware.
export const CANDIDATE_PORTS = [8787, 8788, 8789, 8790];

// Find a companion and take its token, so setup is a button rather than a
// copy-paste. The pairing window on the server side is what makes this safe
// to do; if it has closed, the caller is told to restart or paste by hand.
export async function discover({ pair = true } = {}) {
  for (const port of CANDIDATE_PORTS) {
    let d;
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 800);
      const res = await fetch(`http://127.0.0.1:${port}/ping${pair ? '?pair=1' : ''}`, { signal: c.signal });
      clearTimeout(t);
      d = await res.json();
    } catch (e) { continue; } // nothing listening here, or it is not us
    if (!d || !d.ok) continue;

    // A companion whose window is shut still counts as found: the caller needs
    // to say so, rather than reporting "no companion" and sending the user to
    // start a second one.
    let token = d.token || '';
    if (!token) {
      // The stored token may still be valid from an earlier pair — a closed
      // window does not invalidate it. Try it before asking the user for
      // anything.
      const stored = await withTimeout(chrome.storage.local.get('token'), 1500, {});
      const saved = (stored && stored.token) || '';
      if (saved && await tokenWorks(port, saved)) token = saved;
    }
    return { ok: true, port, roots: d.roots || [], pairing: d.pairing, token };
  }
  return { ok: false, error: 'no companion found. Start it with: npm run attic:serve -- --root <project>' };
}

// Cheapest authenticated call there is: /index on a root we may not know yet
// still tells us 401 (bad token) apart from anything else.
async function tokenWorks(port, token) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/index`, {
      headers: { 'x-attic-token': token },
      signal: c.signal,
    });
    clearTimeout(t);
    return res.status !== 401;
  } catch (e) { return false; }
}

export const api = {
  ping: () => call('/ping'),
  index: (limit) => call('/index', { params: { limit } }),
  recall: (q) => call('/recall', { params: { q } }),
  stash: (item) => call('/stash', { method: 'POST', body: item }),

  // One round trip for the whole attic. The library needs every body anyway —
  // to resolve [[wikilinks]], build backlinks and search text — and fetching
  // them one recall at a time was N requests for the same bytes.
  items: () => call('/items'),
  decisions: () => call('/decisions'),
  validate: () => call('/validate'),

  // PUT, not POST: /stash on an existing slug appends a dated update, which is
  // correct for an agent adding to a finding and wrong for a human fixing one.
  edit: (item) => call('/item', { method: 'PUT', body: item }),
  archive: (slug, restore) => call('/archive', { method: 'POST', body: { slug, restore } }),
  pin: (slug, unpin) => call('/pin', { method: 'POST', body: { slug, unpin } }),
};

// The slug the CLI would generate, so the popup can show the real handle
// before the write happens. Mirrors slugify() in attic.js.
export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
