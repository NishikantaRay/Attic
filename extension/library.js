'use strict';
import { api, discover, settings, slugify } from './api.js';
import { render as md, outline, links as outLinks, snippet, esc } from './markdown.js';

const $ = (id) => document.getElementById(id);
const KINDS = ['finding', 'decision', 'plan', 'output', 'note'];

// ---------------------------------------------------------------------------
// State. One object rather than a scatter of module-level lets, so a view
// switch is a state change followed by one render() and never a half-applied
// UI where the list says one thing and the sidebar another.
// ---------------------------------------------------------------------------
const S = {
  items: [],            // full items: {slug, kind, hook, meta, body, archived}
  bySlug: new Map(),
  decisions: [],
  counts: { items: 0, decisions: 0 },
  backlinks: new Map(), // slug -> [slug] pointing at it
  view: 'all',          // all | pinned | decisions | graph | health
  kind: 'all',
  tag: null,
  sort: 'recent',
  query: '',
  selected: null,
  health: null,         // problem count from /validate, filled in after load
  cursor: -1,           // keyboard position in the rendered list
  mode: 'read',         // read | panel | clip | edit
  editing: null,        // slug being edited, null when clipping something new
};

// ---------------------------------------------------------------------------
// Motion helpers.
//
// A CSS animation only runs when the class is ADDED. Re-rendering a pane that
// already carries `.enter` therefore animates nothing, which is why the class
// is removed, layout is forced, and the class is re-added. Reading offsetWidth
// is the standard way to force that reflow; without it the browser coalesces
// the remove and the add into no change at all.
// ---------------------------------------------------------------------------
function restartAnim(el, cls = 'enter') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow — do not remove, the animation needs it
  el.classList.add(cls);
}

// Cap the stagger so a large attic does not have rows still arriving a second
// after the rest. Past ~10 rows the effect is invisible anyway.
const STAGGER_MAX = 10;

// ---------- setup ----------
async function boot() {
  try {
    const s = await settings();
    if (s.token && s.root) {
      const p = await api.ping();
      // awaited, not returned: `return open()` handed the promise back before
      // the catch could see it, so a failure inside open() was unhandled and
      // left whatever was on screen exactly where it was.
      if (p.ok) { await open(); return; }
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

// ---------- theme ----------
// Three states, not two: "system" is the default and must stay reachable, so
// the toggle cycles rather than flips. An explicit choice stamps data-theme on
// the root, which the CSS honours over prefers-color-scheme in both
// directions.
const THEMES = ['system', 'light', 'dark'];
const THEME_ICON = { system: '◐', light: '☀', dark: '☾' };

function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const btn = $('theme');
  if (btn) {
    btn.textContent = THEME_ICON[t];
    btn.title = `Theme: ${t} (click to change)`;
  }
}

async function initTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  applyTheme(THEMES.includes(theme) ? theme : 'system');
}

$('theme').addEventListener('click', async () => {
  const { theme } = await chrome.storage.local.get('theme');
  const next = THEMES[(THEMES.indexOf(THEMES.includes(theme) ? theme : 'system') + 1) % THEMES.length];
  await chrome.storage.local.set({ theme: next });
  applyTheme(next);
});

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
  $('status-left').textContent = s.root;
  await load();
}

$('root-picker').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ root: e.target.value });
  S.selected = null;
  S.tag = null;
  $('status-left').textContent = e.target.value;
  await load();
});

$('refresh').addEventListener('click', () => load());

/**
 * One request for the whole attic.
 *
 * The previous version fetched the index, then lazily recalled each body for
 * search. Every feature added since — wikilinks, backlinks, body search,
 * tag navigation, the dashboard — needs all the bodies anyway, so N recalls
 * were N round trips for bytes we were always going to want.
 */
function showSkeleton() {
  // A pane that shows its shape while loading reads as fast; a blank one reads
  // as broken. Six rows is enough to fill the fold without pretending to know
  // how many items there are.
  $('list').innerHTML = Array.from({ length: 6 }, () =>
    '<div class="skeleton">' +
      '<div class="skel-line w-60"></div>' +
      '<div class="skel-line w-90"></div>' +
      '<div class="skel-line w-40"></div>' +
    '</div>').join('');
  // The reading pane needs one too, or the right two-thirds of the window sit
  // blank for the whole load and the skeleton only makes that more obvious.
  $('reader').hidden = false;
  $('panel').hidden = true;
  $('clip-form').hidden = true;
  $('reader').innerHTML =
    '<div class="reader-head">' +
      '<div class="skel-line w-60" style="height:20px;margin-bottom:12px"></div>' +
      '<div class="skel-line w-40"></div>' +
    '</div>' +
    '<div class="reader-body"><div>' +
      '<div class="skel-line w-90"></div><div class="skel-line w-90"></div>' +
      '<div class="skel-line w-60"></div>' +
      '<div class="skel-line w-90" style="margin-top:22px"></div>' +
      '<div class="skel-line w-90"></div><div class="skel-line w-40"></div>' +
    '</div></div>';
}

async function load() {
  if (!S.items.length) showSkeleton(); // only on a cold load, not on a refresh
  const r = await api.items();
  if (!r.ok) {
    S.items = []; S.bySlug.clear();
    $('list').innerHTML = `<p class="empty"><b>Nothing to show</b>${esc(r.error || '')}</p>`;
    $('count').textContent = '';
    return;
  }
  S.items = r.items || [];
  S.counts = r.counts || { items: S.items.length, decisions: 0 };
  S.bySlug = new Map(S.items.map((i) => [i.slug, i]));
  buildBacklinks();

  const d = await api.decisions();
  S.decisions = d.ok ? d.decisions : [];

  const v = await api.validate();
  S.health = v && v.problems ? v.problems.length : 0;

  renderSidebar();
  renderTagList();
  render({ animate: true });
  if (S.selected && S.bySlug.has(S.selected)) read(S.selected);
  else if (S.mode === 'read' && !S.selected) showPanel('home');
}

// Backlinks are derived, not stored: an item that adds a [[link]] should show
// up under the target immediately, without the target being rewritten.
function buildBacklinks() {
  S.backlinks = new Map();
  for (const item of S.items) {
    for (const target of outLinks(item.body)) {
      if (target === item.slug) continue;
      if (!S.backlinks.has(target)) S.backlinks.set(target, []);
      S.backlinks.get(target).push(item.slug);
    }
  }
}

// ---------- sidebar ----------
function renderSidebar() {
  const counts = {};
  for (const k of KINDS) counts[k] = S.items.filter((i) => i.kind === k).length;
  const pinned = S.items.filter(isPinned).length;
  const linked = [...S.backlinks.keys()].filter((s) => S.bySlug.has(s)).length;

  $('n-all').textContent = S.items.length || '';
  $('n-pinned').textContent = pinned || '';
  $('n-dec').textContent = S.decisions.length || '';
  $('n-links').textContent = linked || '';
  // Health is the one count that needs a server round trip, so it is filled in
  // after the fact rather than blocking the sidebar on /validate.
  $('n-health').textContent = S.health === null ? '' : (S.health || '✓');

  const box = $('kind-nav');
  box.innerHTML = '';
  for (const k of ['all', ...KINDS]) {
    const b = document.createElement('button');
    b.className = 'nav' + (k === S.kind && S.view === 'all' ? ' on' : '');
    b.innerHTML = k === 'all'
      ? `Any kind <span class="n">${S.items.length || ''}</span>`
      : `<span class="dot" style="color:var(--k-${k})"></span>${k} <span class="n">${counts[k] || ''}</span>`;
    b.onclick = () => { S.kind = k; S.view = 'all'; S.selected = null; renderSidebar(); render(); showList(); };
    box.appendChild(b);
  }

  for (const b of document.querySelectorAll('.side-group .nav[data-view]')) {
    b.classList.toggle('on', b.dataset.view === S.view && !(S.view === 'all' && S.kind !== 'all'));
  }
}

function renderTagList() {
  const freq = new Map();
  for (const i of S.items) {
    for (const t of tagsOf(i)) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const box = $('tag-nav');
  box.innerHTML = '';
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!sorted.length) { box.innerHTML = '<span class="hint" style="padding:0 4px">no tags yet</span>'; }
  for (const [t, n] of sorted) {
    const b = document.createElement('button');
    b.className = 'tag' + (S.tag === t ? ' on' : '');
    b.textContent = `${t} ${n}`;
    b.onclick = () => {
      S.tag = S.tag === t ? null : t;
      S.view = 'all';
      renderTagList(); renderSidebar(); render(); showList();
    };
    box.appendChild(b);
  }
  // Tag autocomplete in the clip form comes from the same set, so the tags in
  // an attic converge instead of sprouting near-duplicates.
  $('tag-list').innerHTML = sorted.map(([t]) => `<option value="${esc(t)}">`).join('');
}

function tagsOf(i) {
  const t = i.meta && i.meta.tags;
  return Array.isArray(t) ? t : (t ? [t] : []);
}
function isPinned(i) { return i.meta && (i.meta.pinned === true || i.meta.pinned === 'true'); }

for (const b of document.querySelectorAll('.nav[data-view]')) {
  b.addEventListener('click', () => {
    S.view = b.dataset.view;
    S.kind = 'all';
    if (S.view !== 'all' && S.view !== 'pinned') { showPanel(S.view); }
    else { showList(); }
    renderSidebar();
    render();
  });
}

// ---------- list ----------
function visible() {
  const q = S.query.toLowerCase().trim();
  let rows = S.items.slice();

  if (S.view === 'pinned') rows = rows.filter(isPinned);
  if (S.kind !== 'all') rows = rows.filter((i) => i.kind === S.kind);
  if (S.tag) rows = rows.filter((i) => tagsOf(i).includes(S.tag));
  if (q) {
    rows = rows.filter((i) =>
      (i.slug + ' ' + i.kind + ' ' + (i.hook || '') + ' ' + (i.meta.title || '') + ' ' + tagsOf(i).join(' ') + ' ' + i.body)
        .toLowerCase().includes(q));
  }

  const date = (i) => (i.meta && i.meta.date) || '';
  const cmp = {
    recent: (a, b) => date(b).localeCompare(date(a)) || a.slug.localeCompare(b.slug),
    oldest: (a, b) => date(a).localeCompare(date(b)) || a.slug.localeCompare(b.slug),
    title: (a, b) => (a.meta.title || a.slug).localeCompare(b.meta.title || b.slug),
    kind: (a, b) => a.kind.localeCompare(b.kind) || date(b).localeCompare(date(a)),
  }[S.sort];
  rows.sort(cmp);

  // Pinned items lead every list: that is what pinning is for.
  return [...rows.filter(isPinned), ...rows.filter((i) => !isPinned(i))];
}

/**
 * Paint the list.
 *
 * `animate` is opt-in and defaults to false on purpose. The common caller is
 * the search box, on every keystroke: re-staggering ten rows per character is
 * the single easiest way to make a fast filter feel slow. Only a genuine
 * reload — a fresh load(), a project switch — passes true.
 */
function render({ animate = false } = {}) {
  const list = $('list');
  const rows = visible();
  list.classList.toggle('staggered', !!animate);
  $('count').textContent = rows.length === S.items.length
    ? `${S.items.length} item${S.items.length === 1 ? '' : 's'}`
    : `${rows.length} of ${S.items.length}`;

  if (!rows.length) {
    list.innerHTML = S.items.length
      ? '<p class="empty"><b>Nothing matches</b>Try a different search or clear the filters.</p>'
      : '<p class="empty"><b>This attic is empty</b>Clip a page, or let Claude stash its first finding.</p>';
    return;
  }

  const q = S.query.trim();
  list.innerHTML = '';
  rows.forEach((e, idx) => {
    const div = document.createElement('div');
    div.className = 'card' + (e.slug === S.selected ? ' on' : '') + (idx === S.cursor ? ' cursor' : '');
    const tags = tagsOf(e).slice(0, 3);
    div.innerHTML =
      `<div class="card-top">` +
        (isPinned(e) ? '<span class="pin-mark" title="pinned">●</span>' : '') +
        `<span class="slug">${esc(e.slug)}</span>` +
        `<span class="date">${esc((e.meta && e.meta.date) || '')}</span>` +
      `</div>` +
      `<div class="hook">${q ? snippet(e.hook || e.body, q, 120) : esc(e.hook || '')}</div>` +
      `<div class="card-foot">` +
        `<span class="kind" data-kind="${esc(e.kind)}">${esc(e.kind)}</span>` +
        tags.map((t) => `<span class="hint">#${esc(t)}</span>`).join('') +
      `</div>`;
    if (animate && idx < STAGGER_MAX) div.style.setProperty('--i', idx);
    div.onclick = () => { S.cursor = idx; read(e.slug); };
    list.appendChild(div);
  });
}

$('sort').addEventListener('change', (e) => { S.sort = e.target.value; render(); });

// ---------- reader ----------
function showList() {
  S.mode = 'read';
  $('reader').hidden = false;
  $('panel').hidden = true;
  $('clip-form').hidden = true;
  if (!S.selected) renderReaderEmpty();
}

// A blank pane reads as a broken one. Whenever nothing is open, say what this
// side is for and what will fill it.
function renderReaderEmpty() {
  const q = S.query.trim();
  const n = visible().length;
  $('reader').innerHTML =
    `<div class="reader-empty">` +
      `<svg class="mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
        `<path d="M50 10 L88 43 L88 52 L50 19 L12 52 L12 43 Z" fill="var(--brand)"/>` +
        `<path d="M20 44 L20 88 L26 88 L26 44 Z" fill="var(--brand)" opacity=".55"/>` +
        `<path d="M74 44 L74 88 L80 88 L80 44 Z" fill="var(--brand)" opacity=".55"/>` +
        `<rect x="30" y="56" width="40" height="9" rx="2.5" fill="var(--stack)" opacity=".5"/>` +
        `<rect x="30" y="69" width="40" height="9" rx="2.5" fill="var(--stack)" opacity=".8"/>` +
        `<rect x="30" y="82" width="40" height="9" rx="2.5" fill="var(--stack-top)"/>` +
      `</svg>` +
      (q
        ? `<b>${n} match${n === 1 ? '' : 'es'} for “${esc(q)}”</b><span>Pick one on the left, or press <kbd>j</kbd> then <kbd>Enter</kbd>.</span>`
        : `<b>Select an item to read it</b><span>Press <kbd>⌘K</kbd> to jump to one, <kbd>/</kbd> to search, or <kbd>g</kbd> then <kbd>h</kbd> for the overview.</span>`) +
    `</div>`;
  restartAnim($('reader').querySelector('.reader-empty'), 'fade-in');
}

function read(slug) {
  const item = S.bySlug.get(slug);
  if (!item) { toast(`no item "${slug}"`, true); return; }
  S.selected = slug;
  S.mode = 'read';
  $('reader').hidden = false;
  $('panel').hidden = true;
  $('clip-form').hidden = true;
  render();

  const slugs = new Set(S.bySlug.keys());
  const heads = outline(item.body);
  const back = (S.backlinks.get(slug) || []).filter((s) => S.bySlug.has(s));
  const forward = outLinks(item.body).filter((s) => S.bySlug.has(s) && s !== slug);

  $('reader').innerHTML =
    `<div class="reader-head">` +
      `<h1>${esc(item.meta.title || slug)}</h1>` +
      `<div class="sub">` +
        `<span class="kind" data-kind="${esc(item.kind)}">${esc(item.kind)}</span>` +
        `<span>${esc(item.meta.date || '')}</span>` +
        `<button class="handle-btn" id="copy-handle" title="Copy handle">attic:${esc(slug)}</button>` +
        tagsOf(item).map((t) => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
        (item.archived ? '<span class="hint">· archived</span>' : '') +
        `<span class="acts">` +
          `<button class="ghost" id="a-edit" title="e">Edit</button>` +
          `<button class="ghost" id="a-pin">${isPinned(item) ? 'Unpin' : 'Pin'}</button>` +
          `<button class="ghost danger" id="a-archive">${item.archived ? 'Restore' : 'Archive'}</button>` +
        `</span>` +
      `</div>` +
    `</div>` +
    `<div class="reader-body">` +
      `<div>` +
        `<div class="prose">${md(item.body, { slugs })}</div>` +
        renderLinkBox(back, forward) +
      `</div>` +
      (heads.length > 1
        ? `<nav class="toc"><div class="toc-title">On this page</div>` +
          heads.map((h) => `<a href="#${h.id}" data-level="${h.level}">${esc(h.text)}</a>`).join('') +
          `</nav>`
        : '') +
    `</div>`;

  // Jump, do not smooth-scroll, when swapping items: `scroll-behavior: smooth`
  // would otherwise animate the new item from wherever the old one was read to.
  $('reader').style.scrollBehavior = 'auto';
  $('reader').scrollTop = 0;
  $('reader').style.scrollBehavior = '';
  restartAnim($('reader').querySelector('.reader-head'));
  restartAnim($('reader').querySelector('.reader-body'));
  wireReader(item);
}

async function togglePin(item) {
  const r = await api.pin(item.slug, isPinned(item));
  if (!r.ok) return toast(r.error || 'could not pin', true);
  toast(r.pinned ? 'pinned' : 'unpinned');
  await load();
}

function renderLinkBox(back, forward) {
  if (!back.length && !forward.length) return '';
  const row = (s) => {
    const i = S.bySlug.get(s);
    return `<div class="link-row" data-slug="${esc(s)}">` +
      `<span class="kind" data-kind="${esc(i.kind)}">${esc(i.kind)}</span>` +
      `<span class="slug">${esc(s)}</span>` +
      `<span class="hook">${esc(i.hook || '')}</span></div>`;
  };
  return '<div class="links-box">' +
    (forward.length ? `<h3>Links to</h3>${forward.map(row).join('')}` : '') +
    (back.length ? `<h3>Linked from</h3>${back.map(row).join('')}` : '') +
    '</div>';
}

function wireReader(item) {
  // Internal navigation: wikilinks, backlink rows and tag chips all move
  // within the library rather than leaving it.
  for (const a of $('reader').querySelectorAll('a.wiki:not(.dangling)')) {
    a.addEventListener('click', (ev) => { ev.preventDefault(); read(a.dataset.slug); });
  }
  for (const r of $('reader').querySelectorAll('.link-row')) {
    r.addEventListener('click', () => read(r.dataset.slug));
  }
  for (const t of $('reader').querySelectorAll('.sub .tag')) {
    t.addEventListener('click', () => {
      S.tag = t.dataset.tag; S.view = 'all'; S.kind = 'all';
      renderTagList(); renderSidebar(); render(); showList();
    });
  }
  // Headings scroll inside the reader pane, not the document, so the default
  // anchor jump would do nothing visible.
  for (const a of $('reader').querySelectorAll('.toc a')) {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const el = $('reader').querySelector('#' + CSS.escape(a.getAttribute('href').slice(1)));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  $('copy-handle').onclick = async () => {
    await navigator.clipboard.writeText(`attic:${item.slug}`);
    toast(`copied attic:${item.slug}`);
  };
  $('a-edit').onclick = () => openEditor(item);
  $('a-pin').onclick = () => togglePin(item);
  $('a-archive').onclick = async () => {
    const restoring = item.archived;
    if (!restoring && !confirm(`Archive ${item.slug}?\n\nIt leaves the index but the file is kept in .attic/archive/, and Claude can still recall it.`)) return;
    const r = await api.archive(item.slug, restoring);
    if (!r.ok) return toast(r.error || 'could not archive', true);
    toast(restoring ? 'restored' : 'archived to .attic/archive/');
    S.selected = restoring ? item.slug : null;
    if (!restoring) S.view = 'all';
    await load();
    if (!restoring) { renderSidebar(); showPanel('home'); }
  };
}

// ---------- panels ----------
function showPanel(which) {
  S.mode = 'panel';
  $('reader').hidden = true;
  $('clip-form').hidden = true;
  $('panel').hidden = false;
  const p = $('panel');
  if (which === 'home') p.innerHTML = homeHtml();
  else if (which === 'decisions') p.innerHTML = decisionsHtml();
  else if (which === 'graph') p.innerHTML = graphHtml();
  else if (which === 'health') { p.innerHTML = '<p class="lede">Checking…</p>'; healthPanel(); return; }
  p.scrollTop = 0;
  restartAnim(p);
  stagger(p);
  wirePanel();
}

// Stat tiles and timeline rows carry their own index so they arrive in
// sequence rather than all at once. Capped for the same reason the list is.
function stagger(root) {
  for (const sel of ['.stat', '.tl-row']) {
    [...root.querySelectorAll(sel)].forEach((el, i) => {
      if (i < STAGGER_MAX) el.style.setProperty('--i', i);
    });
  }
}

function wirePanel() {
  for (const el of $('panel').querySelectorAll('[data-slug]')) {
    el.addEventListener('click', () => read(el.dataset.slug));
  }
}

function homeHtml() {
  const byKind = KINDS.map((k) => ({ k, n: S.items.filter((i) => i.kind === k).length })).filter((x) => x.n);
  const total = byKind.reduce((a, b) => a + b.n, 0) || 1;
  // Sorted here rather than taken from visible(): the overview describes the
  // whole attic, so a kind filter or a search left active in the list must not
  // quietly turn "recently added" into "recently added, of the four items you
  // happen to be filtered to".
  const recent = S.items.slice()
    .sort((a, b) => ((b.meta && b.meta.date) || '').localeCompare((a.meta && a.meta.date) || ''))
    .slice(0, 6);
  const dangling = countDangling();

  return `<h2>This attic</h2>` +
    `<p class="lede">${esc($('root-picker').value || '')}</p>` +
    `<div class="stats">` +
      stat(S.counts.items, 'items') +
      stat(S.decisions.length, 'decisions') +
      stat(S.items.filter(isPinned).length, 'pinned') +
      stat([...new Set(S.items.flatMap(tagsOf))].length, 'tags') +
      stat(dangling, 'dangling links') +
    `</div>` +

    (byKind.length ? `<h3>By kind</h3><div class="bar">` +
      byKind.map((x) => `<span style="width:${(x.n / total) * 100}%;background:var(--k-${x.k})" title="${x.k}: ${x.n}"></span>`).join('') +
      `</div><div class="bar-key">` +
      byKind.map((x) => `<span><i style="background:var(--k-${x.k})"></i>${x.k} ${x.n}</span>`).join('') +
      `</div>` : '') +

    (recent.length ? `<h3>Recently added</h3>` +
      recent.map((i) =>
        `<div class="link-row" data-slug="${esc(i.slug)}">` +
        `<span class="kind" data-kind="${esc(i.kind)}">${esc(i.kind)}</span>` +
        `<span class="slug">${esc(i.slug)}</span>` +
        `<span class="hook">${esc(i.hook || '')}</span>` +
        `<span class="date">${esc(i.meta.date || '')}</span></div>`).join('') : '') +

    (S.decisions.length ? `<h3>Latest decisions</h3><div class="timeline">` +
      S.decisions.slice(-4).reverse().map(decisionRow).join('') + `</div>` : '');
}

function stat(v, l) { return `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`; }

// DECISIONS.md lines are "- <date> · <decision> · because <why>". Split on the
// separator the CLI writes rather than guessing, and degrade to the raw line
// if a hand-edited entry does not match.
function decisionRow(line) {
  const body = line.replace(/^-\s*/, '');
  const m = body.match(/^(\d{4}-\d{2}-\d{2})\s*·\s*([\s\S]*)$/);
  if (!m) return `<div class="tl-row">${esc(body)}</div>`;
  const rest = m[2];
  const cut = rest.search(/·\s*because\b/);
  const what = cut >= 0 ? rest.slice(0, cut).trim() : rest.trim();
  const why = cut >= 0 ? rest.slice(cut).replace(/^·\s*/, '').trim() : '';
  return `<div class="tl-row"><div class="tl-date">${esc(m[1])}</div>` +
    `<div>${esc(what)}</div>` +
    (why ? `<div class="tl-why">${esc(why)}</div>` : '') + `</div>`;
}

function decisionsHtml() {
  if (!S.decisions.length) {
    return `<h2>Decisions</h2><p class="lede">Nothing in DECISIONS.md yet. Every non-trivial decision belongs here with its why.</p>`;
  }
  return `<h2>Decisions</h2>` +
    `<p class="lede">${S.decisions.length} entries from .attic/DECISIONS.md, newest first.</p>` +
    `<div class="timeline">${S.decisions.slice().reverse().map(decisionRow).join('')}</div>`;
}

function countDangling() {
  let n = 0;
  for (const i of S.items) for (const t of outLinks(i.body)) if (!S.bySlug.has(t)) n++;
  return n;
}

function graphHtml() {
  const rows = S.items
    .map((i) => ({
      item: i,
      out: outLinks(i.body).filter((s) => s !== i.slug),
      back: (S.backlinks.get(i.slug) || []).filter((s) => S.bySlug.has(s)),
    }))
    .filter((r) => r.out.length || r.back.length)
    .sort((a, b) => (b.out.length + b.back.length) - (a.out.length + a.back.length));

  const missing = new Map();
  for (const i of S.items) {
    for (const t of outLinks(i.body)) {
      if (S.bySlug.has(t)) continue;
      if (!missing.has(t)) missing.set(t, []);
      missing.get(t).push(i.slug);
    }
  }

  if (!rows.length && !missing.size) {
    return `<h2>Links</h2><p class="lede">No items link to each other yet. ` +
      `Write <code>[[another-slug]]</code> in a body to connect two items — ` +
      `that is what turns a folder of notes into a knowledge base.</p>`;
  }

  return `<h2>Links</h2>` +
    `<p class="lede">How the items reference each other, via <code>[[slug]]</code> and <code>attic:slug</code>.</p>` +
    rows.map((r) =>
      `<div class="link-row" data-slug="${esc(r.item.slug)}">` +
      `<span class="kind" data-kind="${esc(r.item.kind)}">${esc(r.item.kind)}</span>` +
      `<span class="slug">${esc(r.item.slug)}</span>` +
      `<span class="hook">→ ${r.out.length} out · ${r.back.length} in</span></div>`).join('') +
    (missing.size
      ? `<h3>Dangling</h3>` +
        [...missing.entries()].map(([t, from]) =>
          `<div class="health-row warn"><span class="lvl">missing</span>` +
          `<span class="slug">${esc(t)}</span>` +
          `<span class="hint">linked from ${esc(from.join(', '))}</span></div>`).join('')
      : '');
}

async function healthPanel() {
  const r = await api.validate();
  const problems = (r && r.problems) || [];
  $('panel').innerHTML = `<h2>Health</h2>` +
    `<p class="lede">The same checks <code>attic validate</code> runs: index and item files agreeing, frontmatter complete, hooks within the cap.</p>` +
    (problems.length
      ? problems.map((p) =>
          `<div class="health-row ${esc(p.level)}"><span class="lvl">${esc(p.level)}</span>` +
          `<span class="slug" data-slug="${esc(p.slug)}">${esc(p.slug)}</span>` +
          `<span>${esc(p.msg)}</span></div>`).join('')
      : `<p class="all-good">✓ No problems found${r && r.note ? ' — ' + esc(r.note) : ''}.</p>`);
  restartAnim($('panel'));
  wirePanel();
}

// ---------- clip & edit ----------
let clipUrl = '';

function showForm(on) {
  $('clip-form').hidden = !on;
  $('reader').hidden = on;
  $('panel').hidden = true;
  if (on) {
    $('clip-form').scrollTop = 0;
    restartAnim($('clip-form'));
  }
  if (!on) { S.mode = 'read'; S.editing = null; }
}

// Read the active tab from the library tab. The library is itself a tab, so
// "active tab" means the last real page the user was on, not this one.
// Pages the extension cannot read, and would have nothing useful to say about.
function clippable(t) {
  const u = t && t.url ? t.url : '';
  return !!u && !/^(chrome|chrome-extension|edge|brave|about|devtools|view-source|file):/.test(u);
}

async function grabActive() {
  // NOT {active: true}. The library is itself a tab, so while you are looking
  // at it the active tab IS the library — it gets filtered out as
  // chrome-extension://, nothing is left, and the clip form opens blank.
  // Query the whole window instead and take the most recently used page,
  // which is the one the user was reading before they opened this.
  const all = await chrome.tabs.query({ lastFocusedWindow: true });
  const candidates = all.filter(clippable);
  // lastAccessed is not in every Chrome version; fall back to the active tab,
  // then to the last candidate in tab order.
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const tab = candidates[0]
    || (await chrome.tabs.query({ active: true, currentWindow: true })).find(clippable);
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

async function startClip() {
  S.mode = 'clip';
  S.editing = null;
  showForm(true);
  $('clip-heading').textContent = 'Clip a page';
  $('do-stash').textContent = 'Stash to attic';
  $('f-title').disabled = false;
  $('clip-msg').hidden = true;
  const p = await grabActive();
  clipUrl = p.url;
  $('f-title').value = p.title;
  $('f-kind').value = 'note';
  $('f-tags').value = '';
  $('f-hook').value = p.text.replace(/\s+/g, ' ').slice(0, 100);
  $('f-body').value = p.text;
  syncHandle();
  if (!p.url) {
    const m = $('clip-msg');
    m.hidden = false; m.className = 'msg bad';
    m.textContent = 'Nothing to clip: no ordinary web page is open in this window. '
      + 'Open the page you want to save in another tab, then click Clip tab. '
      + 'You can still write an item by hand here.';
  } else if (!p.text) {
    // A page whose text could not be read (a PDF viewer, the Web Store, a page
    // loaded before the extension) still gives a usable title and URL, so say
    // what happened rather than leaving an unexplained empty body.
    const m = $('clip-msg');
    m.hidden = false; m.className = 'msg';
    m.textContent = `Got the title and URL of “${p.title || p.url}”, but its text could not be read. `
      + 'Paste what you want to keep into the body.';
  }
}

// Editing is a different write from stashing: /stash on an existing slug
// appends a dated "## Update" section, which is right for an agent adding to a
// finding and wrong for a person fixing a typo in one. The form is the same;
// the endpoint is not.
function openEditor(item) {
  S.mode = 'edit';
  S.editing = item.slug;
  clipUrl = '';
  showForm(true);
  $('clip-heading').textContent = `Editing ${item.slug}`;
  $('do-stash').textContent = 'Save changes';
  // The slug is the item's identity and the thing every [[link]] and handle
  // points at, so renaming it here would quietly break those. Retitle freely;
  // the slug stays.
  $('f-title').disabled = false;
  $('f-title').value = item.meta.title || item.slug;
  $('f-kind').value = item.kind;
  $('f-tags').value = tagsOf(item).join(', ');
  $('f-hook').value = item.hook || '';
  $('f-body').value = item.body;
  $('f-handle').textContent = 'attic:' + item.slug;
  $('f-dupe').hidden = true;
  $('clip-msg').hidden = true;
  syncCount();
}

$('clip').addEventListener('click', startClip);
$('cancel-clip').addEventListener('click', () => {
  showForm(false);
  if (S.selected) read(S.selected); else showPanel('home');
});

function syncHandle() {
  if (S.editing) return; // an edit never re-slugs; see openEditor
  const slug = slugify($('f-title').value);
  $('f-handle').textContent = 'attic:' + (slug || '…');
  const dupe = slug && S.bySlug.has(slug);
  $('f-dupe').hidden = !dupe;
  if (dupe) $('f-dupe').textContent = '· exists — this will append a dated update';
  syncCount();
}
function syncCount() {
  const n = $('f-body').value.length;
  $('f-count').textContent = n ? `${n.toLocaleString()} chars` : '';
}
$('f-title').addEventListener('input', syncHandle);
$('f-body').addEventListener('input', syncCount);

$('do-stash').addEventListener('click', save);

async function save() {
  const btn = $('do-stash');
  const m = $('clip-msg');
  const title = $('f-title').value.trim();
  if (!title) { m.hidden = false; m.className = 'msg bad'; m.textContent = 'A title is required.'; return; }

  const editing = S.editing;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = editing ? 'Saving…' : 'Stashing…';
  const body = $('f-body').value.trim();
  const payload = {
    slug: editing || slugify(title),
    title,
    kind: $('f-kind').value,
    hook: $('f-hook').value.trim(),
    tags: $('f-tags').value.trim(),
    body: clipUrl ? `Source: ${clipUrl}\n\n${body}` : body,
  };
  const r = editing ? await api.edit(payload) : await api.stash(payload);
  btn.disabled = false; btn.textContent = label;

  m.hidden = false;
  if (r.ok) {
    m.className = 'msg ok';
    m.textContent = editing ? 'Saved.' : `Stashed ${r.handle}${r.appended ? ' (appended)' : ''}`;
    S.selected = r.slug;
    await load();
    showForm(false);
    read(r.slug);
    toast(editing ? 'saved' : `stashed attic:${r.slug}`);
  } else {
    m.className = 'msg bad';
    // A refusal is the secret scan, and it is the one failure worth spelling
    // out: the fix is to redact the text, not to retry.
    m.textContent = (r.refused ? 'Refused — ' : '') + (r.error || 'could not save');
  }
}

// ---------- search ----------
let searchTimer;
$('q').addEventListener('input', (e) => {
  S.query = e.target.value;
  clearTimeout(searchTimer);
  // Debounced: every keystroke re-filters and re-renders every card, and on a
  // large attic that is felt.
  searchTimer = setTimeout(() => {
    S.cursor = -1;
    render();
    // A search never closes an open item; showList() only repaints the empty
    // pane, and it does that with the new result count.
    if (S.mode === 'read') showList();
  }, 90);
});

// ---------- command palette ----------
const COMMANDS = [
  { id: 'clip', label: 'Clip the current tab', run: startClip },
  { id: 'home', label: 'Go to the overview', run: () => showPanel('home') },
  { id: 'decisions', label: 'Show decisions', run: () => { S.view = 'decisions'; renderSidebar(); showPanel('decisions'); } },
  { id: 'graph', label: 'Show links between items', run: () => { S.view = 'graph'; renderSidebar(); showPanel('graph'); } },
  { id: 'health', label: 'Check attic health', run: () => { S.view = 'health'; renderSidebar(); showPanel('health'); } },
  { id: 'refresh', label: 'Reload from disk', run: () => load() },
  { id: 'theme', label: 'Change theme', run: () => $('theme').click() },
  { id: 'settings', label: 'Connection settings', run: showSetup },
];

let pRows = [], pCursor = 0;

function openPalette() {
  $('palette').hidden = false;
  $('p-input').value = '';
  paletteSearch('');
  $('p-input').focus();
}
function closePalette() { $('palette').hidden = true; }

function paletteSearch(q) {
  const needle = q.toLowerCase().trim();
  const cmds = COMMANDS
    .filter((c) => !needle || c.label.toLowerCase().includes(needle) || c.id.includes(needle))
    .map((c) => ({ type: 'cmd', label: c.label, run: c.run }));
  // Fuzzy-ish: every character of the query in order. Enough to make "clex"
  // find "chrome-extension" without pulling in a matcher library.
  const items = S.items
    .filter((i) => !needle || fuzzy(i.slug + ' ' + (i.meta.title || ''), needle) || (i.hook || '').toLowerCase().includes(needle))
    .slice(0, 30)
    .map((i) => ({ type: 'item', item: i, run: () => read(i.slug) }));
  pRows = needle ? [...items, ...cmds] : [...cmds, ...items];
  pCursor = 0;
  renderPalette();
}

function fuzzy(hay, needle) {
  const h = hay.toLowerCase();
  let i = 0;
  for (const c of needle) {
    i = h.indexOf(c, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

function renderPalette() {
  const box = $('p-results');
  if (!pRows.length) { box.innerHTML = '<div class="p-empty">Nothing matches.</div>'; return; }
  box.innerHTML = pRows.map((r, i) =>
    r.type === 'cmd'
      ? `<div class="p-row${i === pCursor ? ' on' : ''}" data-i="${i}"><span>${esc(r.label)}</span><span class="go">command</span></div>`
      : `<div class="p-row${i === pCursor ? ' on' : ''}" data-i="${i}">` +
        `<span class="kind" data-kind="${esc(r.item.kind)}">${esc(r.item.kind)}</span>` +
        `<span class="slug">${esc(r.item.slug)}</span>` +
        `<span class="hook">${esc(r.item.hook || '')}</span></div>`
  ).join('');
  for (const el of box.querySelectorAll('.p-row')) {
    el.addEventListener('click', () => runPalette(parseInt(el.dataset.i, 10)));
  }
  const on = box.querySelector('.p-row.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function runPalette(i) {
  const r = pRows[i];
  if (!r) return;
  closePalette();
  r.run();
}

$('p-input').addEventListener('input', (e) => paletteSearch(e.target.value));
$('p-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); pCursor = Math.min(pCursor + 1, pRows.length - 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pCursor = Math.max(pCursor - 1, 0); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(pCursor); }
  else if (e.key === 'Escape') closePalette();
});
$('palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });

// ---------- keyboard ----------
const KEYMAP = [
  ['⌘K / Ctrl-K', 'Jump to an item or run a command'],
  ['/', 'Focus search'],
  ['j / k', 'Move down / up the list'],
  ['Enter', 'Open the item under the cursor'],
  ['e', 'Edit the open item'],
  ['c', 'Clip the current tab'],
  ['p', 'Pin or unpin the open item'],
  ['g then h', 'Overview'],
  ['g then d', 'Decisions'],
  ['r', 'Reload from disk'],
  ['Esc', 'Close, or leave the form'],
  ['?', 'This list'],
];
$('keys-list').innerHTML = KEYMAP.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd>`).join('');
$('keys-close').addEventListener('click', () => { $('keys').hidden = true; });
$('keys').addEventListener('click', (e) => { if (e.target.id === 'keys') $('keys').hidden = true; });

function typing(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

let gPending = false;
document.addEventListener('keydown', (e) => {
  // The palette owns its own keys, and a modifier combo must reach it even
  // while an input is focused.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('palette').hidden ? openPalette() : closePalette();
    return;
  }
  if (!$('palette').hidden) return;

  if (e.key === 'Escape') {
    if (!$('keys').hidden) { $('keys').hidden = true; return; }
    if (typing(document.activeElement)) { document.activeElement.blur(); return; }
    if (S.mode === 'clip' || S.mode === 'edit') { showForm(false); if (S.selected) read(S.selected); else showPanel('home'); }
    return;
  }

  // Cmd-Enter saves from inside the form: the buttons are below a long
  // textarea and reaching for the mouse to save is the wrong shape.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && (S.mode === 'clip' || S.mode === 'edit')) {
    e.preventDefault(); save(); return;
  }

  if (typing(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (gPending) {
    gPending = false;
    if (e.key === 'h') { S.view = 'all'; renderSidebar(); showPanel('home'); return; }
    if (e.key === 'd') { S.view = 'decisions'; renderSidebar(); showPanel('decisions'); return; }
    if (e.key === 'l') { S.view = 'graph'; renderSidebar(); showPanel('graph'); return; }
  }

  switch (e.key) {
    case '/': e.preventDefault(); $('q').focus(); $('q').select(); break;
    case '?': e.preventDefault(); $('keys').hidden = false; break;
    case 'g': gPending = true; setTimeout(() => { gPending = false; }, 900); break;
    case 'j': case 'ArrowDown': e.preventDefault(); moveCursor(1); break;
    case 'k': case 'ArrowUp': e.preventDefault(); moveCursor(-1); break;
    case 'Enter': {
      const rows = visible();
      if (rows[S.cursor]) read(rows[S.cursor].slug);
      break;
    }
    case 'c': startClip(); break;
    case 'r': load(); break;
    case 'e': {
      const item = S.selected && S.bySlug.get(S.selected);
      if (item) openEditor(item);
      break;
    }
    case 'p': {
      // Not $('a-pin').click(): that button only exists while the reader is on
      // screen, so the key did nothing from a panel view even with an item
      // selected. Go through the API the button goes through.
      const item = S.selected && S.bySlug.get(S.selected);
      if (item) togglePin(item);
      break;
    }
  }
});

function moveCursor(d) {
  const rows = visible();
  if (!rows.length) return;
  S.cursor = Math.max(0, Math.min(rows.length - 1, S.cursor + d));
  render();
  const el = $('list').children[S.cursor];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

// ---------- toast ----------
let toastTimer, toastHide;
function toast(text, bad) {
  const t = $('toast');
  clearTimeout(toastTimer);
  clearTimeout(toastHide);
  t.textContent = text;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  // Re-trigger the entrance so a second toast arriving while the first is up
  // animates in again rather than silently swapping its text.
  restartAnim(t, 'toast-show');
  toastTimer = setTimeout(() => {
    // Fade out rather than vanishing. The element stays until the animation
    // ends, so `hidden` is set on a timer matched to the CSS duration.
    t.classList.add('toast-out');
    toastHide = setTimeout(() => {
      t.hidden = true;
      t.classList.remove('toast-out');
    }, 200);
  }, 2200);
}

initTheme();
boot();
