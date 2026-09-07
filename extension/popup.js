'use strict';
import { api, slugify } from './api.js';

const $ = (id) => document.getElementById(id);

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-on', x === t));
    $('panel-clip').hidden = t.dataset.tab !== 'clip';
    $('panel-browse').hidden = t.dataset.tab !== 'browse';
    if (t.dataset.tab === 'browse') loadIndex();
  });
});

// ---------- status ----------
async function ping() {
  const r = await api.ping();
  const el = $('status');
  if (r.ok) { el.className = 'status on'; el.textContent = 'connected'; }
  else { el.className = 'status off'; el.textContent = r.offline ? 'no companion' : 'error'; }
  $('do-stash').disabled = !r.ok;
  return r.ok;
}

// ---------- clip ----------
// Pull the page's own text so the body is the article, not the chrome around
// it. Falls back to the selection, then to nothing: a title and a URL are
// still worth keeping.
async function grabPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { title: '', url: '', text: '' };
  let text = '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = String(window.getSelection() || '').trim();
        if (sel) return sel;
        const main = document.querySelector('article, main, [role=main]') || document.body;
        return (main.innerText || '').trim().slice(0, 4000);
      },
    });
    text = result || '';
  } catch (e) { /* restricted page (chrome://, store) — title and URL only */ }
  return { title: tab.title || '', url: tab.url || '', text };
}

let pageUrl = '';

async function initClip() {
  const p = await grabPage();
  pageUrl = p.url;
  $('f-title').value = p.title;
  $('f-hook').value = p.text.replace(/\s+/g, ' ').slice(0, 100);
  $('f-body').value = p.text;
  syncHandle();
}

function syncHandle() {
  const s = slugify($('f-title').value);
  $('f-handle').textContent = 'attic:' + (s || '…');
}
$('f-title').addEventListener('input', syncHandle);

$('do-stash').addEventListener('click', async () => {
  const btn = $('do-stash');
  const msg = $('clip-msg');
  const title = $('f-title').value.trim();
  if (!title) { show(msg, 'bad', 'A title is required.'); return; }

  btn.disabled = true;
  btn.textContent = 'Stashing…';
  const body = $('f-body').value.trim();
  const r = await api.stash({
    slug: slugify(title),
    title,
    kind: $('f-kind').value,
    hook: $('f-hook').value.trim(),
    tags: $('f-tags').value.trim(),
    body: pageUrl ? `Source: ${pageUrl}\n\n${body}` : body,
  });
  btn.disabled = false;
  btn.textContent = 'Stash to attic';

  if (r.ok) show(msg, 'ok', `Stashed \`${r.handle}\`${r.appended ? ' (appended)' : ''}`);
  else if (r.refused) show(msg, 'bad', r.error);
  else show(msg, 'bad', r.error || 'could not stash');
});

function show(el, cls, text) {
  el.hidden = false;
  el.className = 'msg ' + cls;
  el.textContent = text;
}

// ---------- browse ----------
let entries = [];

async function loadIndex() {
  const r = await api.index();
  const box = $('results');
  if (!r.ok) { box.innerHTML = `<p class="empty">${escapeHtml(r.error || 'nothing to show')}</p>`; return; }
  entries = r.items || [];
  render(entries);
}

function render(list) {
  const box = $('results');
  if (!list.length) { box.innerHTML = '<p class="empty">nothing in the attic yet</p>'; return; }
  box.innerHTML = '';
  for (const e of list) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML =
      `<div><span class="slug">${escapeHtml(e.slug)}</span><span class="kind">${escapeHtml(e.kind)}</span></div>` +
      `<div class="hook">${escapeHtml(e.hook || '')}</div>`;
    div.addEventListener('click', () => expand(div, e.slug));
    box.appendChild(div);
  }
}

// Click an index line to pull the item body through recall, so the popup
// shows what the agent would see rather than just the one-line hook.
async function expand(div, slug) {
  const open = div.querySelector('.full');
  if (open) { open.remove(); return; }
  const r = await api.recall(slug);
  const pre = document.createElement('div');
  pre.className = 'full';
  pre.textContent = r.ok ? r.body : (r.error || 'could not recall');
  div.appendChild(pre);
}

$('q').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return render(entries);
  render(entries.filter((x) => (x.slug + ' ' + x.kind + ' ' + (x.hook || '')).toLowerCase().includes(q)));
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- boot ----------
(async () => { if (await ping()) initClip(); })();
