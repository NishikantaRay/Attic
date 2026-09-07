'use strict';
import { api, discover, settings, slugify } from './api.js';

const $ = (id) => document.getElementById(id);
const KINDS = ['finding', 'decision', 'plan', 'output', 'note'];

let entries = [];      // index lines for the current root
let bodies = new Map(); // slug -> body, filled lazily so search can reach text
let kind = 'all';
let selected = null;

// ---------- setup ----------
async function boot() {
  try {
    const s = await settings();
    if (s.token && s.root) {
      const p = await api.ping();
      if (p.ok) return open();
    }
  } catch (e) { /* fall through to setup, which reports properly */ }
  showSetup();
}

function showSetup() {
  $('setup').hidden = false;
  $('app').hidden = true;
  autoDiscover();
}

// One button instead of copying 48 hex characters. The server only parts with
// the token during its pairing window, so this cannot be done behind the
// user's back long after they started it.
async function autoDiscover() {
  // Last line of defence. If discovery neither resolves nor throws, the card
  // would sit on "Looking for a companion…" forever; say so instead.
  const watchdog = setTimeout(() => {
    const msg = $('setup-msg');
    if (!msg.textContent.startsWith('Looking')) return;
    msg.className = 'setup-msg bad';
    msg.textContent = 'Discovery timed out. Is the companion running?';
    const btn = $('setup-btn');
    btn.hidden = false;
    btn.textContent = 'Try again';
    btn.onclick = autoDiscover;
  }, 6000);

  try { await autoDiscoverInner(); }
  catch (e) {
    // A silent throw here is what leaves the card stuck on "Looking for a
    // companion…", which looks identical to a hang. Always land somewhere.
    const msg = $('setup-msg');
    msg.className = 'setup-msg bad';
    msg.textContent = 'Discovery failed: ' + (e && e.message ? e.message : e);
    const btn = $('setup-btn');
    btn.hidden = false;
    btn.textContent = 'Try again';
    btn.onclick = autoDiscover;
  }
  finally { clearTimeout(watchdog); }
}

async function autoDiscoverInner() {
  const msg = $('setup-msg');
  const detail = $('setup-detail');
  const btn = $('setup-btn');
  msg.className = 'setup-msg';
  msg.textContent = 'Looking for a companion…';
  btn.hidden = true;
  detail.hidden = true;

  const d = await discover();
  if (!d.ok) {
    msg.className = 'setup-msg bad';
    msg.textContent = 'No companion found.';
    detail.hidden = false;
    // Brave (and similar) block extension pages from reaching 127.0.0.1 by
    // default, which looks exactly like "nothing is running". Name it, because
    // the user cannot guess it from a generic failure.
    detail.innerHTML =
      'Start it in your project, then reload:<br>' +
      '<code>npm run attic:serve -- --root /path/to/project</code>' +
      '<br><br>Already running? If this is <b>Brave</b>, open <code>brave://settings/shields</code> ' +
      'and allow localhost access, or lower Shields for extension pages. ' +
      'Some browsers block extensions from reaching <code>127.0.0.1</code>.';
    btn.hidden = false;
    btn.textContent = 'Look again';
    btn.onclick = autoDiscover;
    return;
  }

  if (!d.token) {
    // Found it, but the window is shut. Restarting a running daemon is a bad
    // habit to teach, so lead with the keystroke that reopens it.
    msg.className = 'setup-msg';
    msg.textContent = `Found a companion on port ${d.port}, but pairing is closed.`;
    detail.hidden = false;
    detail.innerHTML = d.pairing === 'disabled'
      ? 'It was started with <code>--no-pair</code>. Paste the token under Advanced.'
      : 'Reopen pairing by running<br><code>npm run attic:pair</code><br>' +
        'or by pressing <b>Enter</b> in the companion\'s terminal. Then click below.';
    btn.hidden = false;
    btn.textContent = 'Try again';
    btn.onclick = autoDiscover;
    return;
  }

  msg.className = 'setup-msg ok';
  msg.textContent = `Found a companion on port ${d.port}.`;
  detail.hidden = false;
  detail.innerHTML = d.roots.map((r) => `<div>${esc(r)}</div>`).join('') || '<div>(no roots)</div>';
  btn.hidden = false;
  btn.textContent = d.roots.length > 1 ? `Connect to ${d.roots.length} projects` : 'Connect';
  btn.onclick = async () => {
    await chrome.storage.local.set({ port: d.port, token: d.token, root: d.roots[0] || '', roots: d.roots });
    open();
  };
}

$('s-save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    port: parseInt($('s-port').value, 10) || 8787,
    token: $('s-token').value.trim(),
    root: $('s-root').value.trim(),
    roots: [$('s-root').value.trim()],
  });
  const p = await api.ping();
  if (p.ok) open();
  else { const m = $('setup-msg'); m.className = 'setup-msg bad'; m.textContent = p.error || 'could not connect'; }
});

$('settings').addEventListener('click', showSetup);

// ---------- app ----------
async function open() {
  $('setup').hidden = true;
  $('app').hidden = false;
  const s = await settings();
  const roots = (await chrome.storage.local.get('roots')).roots || [s.root];
  const picker = $('root-picker');
  picker.innerHTML = '';
  for (const r of roots) {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = r.split('/').slice(-2).join('/') || r; // last two segments read better than a full path
    o.title = r;
    picker.appendChild(o);
  }
  picker.value = s.root;
  picker.hidden = roots.length < 2;
  renderFilters();
  await load();
}

$('root-picker').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ root: e.target.value });
  selected = null;
  bodies.clear();
  $('reader').innerHTML = '<div class="reader-empty">Select an item to read it.</div>';
  await load();
});

$('refresh').addEventListener('click', () => { bodies.clear(); load(); });

async function load() {
  const r = await api.index();
  if (!r.ok) {
    entries = [];
    $('list').innerHTML = `<p class="empty">${esc(r.error || 'nothing to show')}</p>`;
    $('count').textContent = '';
    return;
  }
  entries = r.items || [];
  $('count').textContent = `${r.counts.items} item${r.counts.items === 1 ? '' : 's'}`;
  render();
}

function renderFilters() {
  const box = $('filters');
  box.innerHTML = '';
  for (const k of ['all', ...KINDS]) {
    const b = document.createElement('button');
    b.className = 'chip' + (k === kind ? ' on' : '');
    b.textContent = k;
    b.onclick = () => { kind = k; renderFilters(); render(); };
    box.appendChild(b);
  }
}

function visible() {
  const q = $('q').value.toLowerCase().trim();
  return entries.filter((e) => {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (!q) return true;
    const body = bodies.get(e.slug) || '';
    return (e.slug + ' ' + e.kind + ' ' + (e.hook || '') + ' ' + body).toLowerCase().includes(q);
  });
}

function render() {
  const list = $('list');
  const rows = visible();
  if (!rows.length) {
    list.innerHTML = `<p class="empty">${entries.length ? 'nothing matches' : 'nothing in this attic yet'}</p>`;
    return;
  }
  list.innerHTML = '';
  for (const e of rows) {
    const div = document.createElement('div');
    div.className = 'card' + (e.slug === selected ? ' on' : '');
    div.innerHTML =
      `<div class="slug">${esc(e.slug)}</div>` +
      `<div class="meta">${esc(e.kind)}</div>` +
      `<div class="hook">${esc(e.hook || '')}</div>`;
    div.onclick = () => read(e.slug);
    list.appendChild(div);
  }
}

async function read(slug) {
  showClip(false);
  selected = slug;
  render();
  const reader = $('reader');
  reader.innerHTML = '<div class="reader-empty">Loading…</div>';
  const r = await api.recall(slug);
  if (!r.ok) { reader.innerHTML = `<div class="reader-empty">${esc(r.error || 'could not recall')}</div>`; return; }
  bodies.set(slug, r.body || '');
  reader.innerHTML =
    `<h1>${esc(r.meta.title || slug)}</h1>` +
    `<div class="sub">${esc(r.meta.kind)} · ${esc(r.meta.date || '')} · <code>${esc(r.handle)}</code>` +
    (r.meta.tags && r.meta.tags.length ? ` · ${esc([].concat(r.meta.tags).join(', '))}` : '') + `</div>` +
    `<div class="body">${linkify(r.body || '')}</div>`;
}

// Clips carry a Source: URL as their first line; make it clickable, but only
// after escaping, so a hostile clip cannot inject markup.
function linkify(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

// Search needs bodies, but fetching them all on load would hammer the server
// for a big attic. Pull them once, in the background, after first paint.
async function warmBodies() {
  for (const e of entries) {
    if (bodies.has(e.slug)) continue;
    const r = await api.recall(e.slug);
    if (r.ok) bodies.set(e.slug, r.body || '');
  }
}

// ---------- clip ----------
let clipUrl = '';

function showClip(on) {
  $('clip-form').hidden = !on;
  $('reader').hidden = on;
}

// Read the active tab from the library tab. The library is itself a tab, so
// "active tab" means the last real page the user was on, not this one.
async function grabActive() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find((t) => !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
  if (!tab) return { title: '', url: '', text: '' };
  let text = '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = String(window.getSelection() || '').trim();
        if (sel) return sel;
        const main = document.querySelector('article, main, [role=main]') || document.body;
        return (main.innerText || '').trim().slice(0, 8000);
      },
    });
    text = result || '';
  } catch (e) { /* restricted page: title and URL are still worth keeping */ }
  return { title: tab.title || '', url: tab.url || '', text };
}

$('clip').addEventListener('click', async () => {
  showClip(true);
  $('clip-msg').hidden = true;
  const p = await grabActive();
  clipUrl = p.url;
  $('f-title').value = p.title;
  $('f-hook').value = p.text.replace(/\s+/g, ' ').slice(0, 100);
  $('f-body').value = p.text;
  syncHandle();
  if (!p.url) {
    const m = $('clip-msg');
    m.hidden = false; m.className = 'msg bad';
    m.textContent = 'No clippable tab found — open a normal web page, then click Clip tab.';
  }
});

$('cancel-clip').addEventListener('click', () => showClip(false));

function syncHandle() {
  $('f-handle').textContent = 'attic:' + (slugify($('f-title').value) || '…');
}
$('f-title').addEventListener('input', syncHandle);

$('do-stash').addEventListener('click', async () => {
  const btn = $('do-stash');
  const m = $('clip-msg');
  const title = $('f-title').value.trim();
  if (!title) { m.hidden = false; m.className = 'msg bad'; m.textContent = 'A title is required.'; return; }

  btn.disabled = true; btn.textContent = 'Stashing…';
  const body = $('f-body').value.trim();
  const r = await api.stash({
    slug: slugify(title), title,
    kind: $('f-kind').value,
    hook: $('f-hook').value.trim(),
    tags: $('f-tags').value.trim(),
    body: clipUrl ? `Source: ${clipUrl}\n\n${body}` : body,
  });
  btn.disabled = false; btn.textContent = 'Stash to attic';
  m.hidden = false;
  if (r.ok) {
    m.className = 'msg ok';
    m.textContent = `Stashed ${r.handle}${r.appended ? ' (appended)' : ''}`;
    bodies.clear();
    await load();
    setTimeout(() => { showClip(false); read(r.slug); }, 700);
  } else {
    m.className = 'msg bad';
    m.textContent = r.error || 'could not stash';
  }
});

$('q').addEventListener('input', render);
$('q').addEventListener('focus', warmBodies, { once: true });

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();
