'use strict';
/**
 * Shared client for the localhost companion. Imported by the popup, the
 * options page and the service worker, so the token/port handling lives once.
 */
const DEFAULTS = { port: 8787, token: '', root: '' };

export async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
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
export async function discover() {
  for (const port of CANDIDATE_PORTS) {
    let res;
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 400);
      res = await fetch(`http://127.0.0.1:${port}/ping?pair=1`, { signal: c.signal });
      clearTimeout(t);
    } catch (e) { continue; }
    let d;
    try { d = await res.json(); } catch (e) { continue; }
    if (!d || !d.ok) continue;
    return { ok: true, port, roots: d.roots || [], pairing: d.pairing, token: d.token || '' };
  }
  return { ok: false, error: 'no companion found. Start it with: npm run attic:serve -- --root <project>' };
}

export const api = {
  ping: () => call('/ping'),
  index: (limit) => call('/index', { params: { limit } }),
  recall: (q) => call('/recall', { params: { q } }),
  stash: (item) => call('/stash', { method: 'POST', body: item }),
};

// The slug the CLI would generate, so the popup can show the real handle
// before the write happens. Mirrors slugify() in attic.js.
export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
