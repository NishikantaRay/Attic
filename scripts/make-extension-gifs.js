#!/usr/bin/env node
'use strict';
/**
 * make-extension-gifs.js — scene frames for the two browser-extension GIFs.
 *
 * 1. clip     — selecting text on a page and stashing it into .attic/
 * 2. library  — what the library does with the items afterwards
 *
 * Generated rather than screen-recorded, for the same reasons as
 * assets/frames: an SVG scene is diffable, regenerates when the UI changes,
 * bakes in no OS theme or window size, and leaks nothing from a real browser.
 *
 * GitHub renders SVG without external CSS, so every colour is inline. These
 * are Attic's own tokens, so the GIF matches the extension rather than an
 * invented palette.
 *
 * Assembled by: scripts/make-gif.sh clip   (and ... library)
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');

// Two palettes, not one design dimmed. The light values are the same tokens
// extension/library.css defines for its light theme, so the GIF matches the
// real extension in either mode.
const THEMES = {
  dark: {
    bg: '#0d1117', panel: '#161b22', raised: '#1c2128', line: '#30363d',
    text: '#e6edf3', dim: '#8b949e', faint: '#6e7681',
    accent: '#58a6ff', good: '#3fb950', warn: '#d29922',
    sel: '#1f6feb', selbg: '#173a6b', navOn: '#10305c', cardOn: '#0c2d6b',
    selText: '#ffffff',
    mark: '#4d3800', scrim: '#010409', scrimAlpha: 0.72, chromeBg: '#161b22',
    stack: '#aecfb8', stackTop: '#3fb950', violet: '#bc8cff',
    shadow: '#010409',
  },
  light: {
    bg: '#ffffff', panel: '#f6f8fa', raised: '#ffffff', line: '#d1d9e0',
    text: '#1f2328', dim: '#59636e', faint: '#818b98',
    accent: '#0969da', good: '#1a7f37', warn: '#9a6700',
    sel: '#0969da', selbg: '#b6e3ff', navOn: '#ddf4ff', cardOn: '#ddf4ff',
    selText: '#0a1929',
    mark: '#fff3c4', scrim: '#1f2328', scrimAlpha: 0.55, chromeBg: '#f6f8fa',
    stack: '#aecfb8', stackTop: '#1a7f37', violet: '#8250df',
    shadow: '#1f2328',
  },
};

const FONTS = {
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  sans: '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif',
};

// Set per build by render(). Every draw helper reads this.
let C = { ...THEMES.dark, ...FONTS };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Scene size. The ffmpeg crop in make-gif.sh is derived from these, because
// qlmanage pads its render to a square — a mismatch letterboxes every frame.
const W = 900, H = 500;

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
${body}
</svg>`;
}

const text = (x, y, s, { size = 13, fill = C.text, font = C.sans, weight, anchor, opacity } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}"` +
  `${weight ? ` font-weight="${weight}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''}` +
  `${opacity ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;

const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 6}" fill="${o.fill || C.panel}"` +
  `${o.stroke ? ` stroke="${o.stroke}"` : ''}${o.sw ? ` stroke-width="${o.sw}"` : ''}` +
  `${o.opacity ? ` opacity="${o.opacity}"` : ''}/>`;

/** The caption strip every scene carries, so the story reads without sound. */
const caption = (n, s) =>
  text(20, H - 18, `${n}. ${s}`, { size: 15, weight: 600, fill: C.accent });

/** Browser window chrome: traffic lights, a URL pill, and the Attic toolbar icon. */
function chrome_(url, { active } = {}) {
  return `
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.panel, stroke: C.line })}
<circle cx="38" cy="40" r="6" fill="#ff5f56"/><circle cx="58" cy="40" r="6" fill="#ffbd2e"/><circle cx="78" cy="40" r="6" fill="#27c93f"/>
${rect(100, 28, W - 190, 25, { r: 12, fill: C.bg, stroke: C.line })}
${text(114, 45, url, { size: 12, fill: C.dim, font: C.mono })}
${atticIcon(W - 66, 28, active)}
<line x1="14" y1="66" x2="${W - 14}" y2="66" stroke="${C.line}"/>`;
}

/** The Attic mark — a roof over three stacked boxes, as in assets/logo.svg. */
function atticIcon(x, y, active) {
  const s = 0.25;
  return `<g transform="translate(${x},${y}) scale(${s})">
${active ? `<rect x="-14" y="-14" width="128" height="128" rx="24" fill="${C.accent}" opacity=".18"/>` : ''}
<path d="M50 10 L88 43 L88 52 L50 19 L12 52 L12 43 Z" fill="${C.accent}"/>
<path d="M20 44 L20 88 L26 88 L26 44 Z" fill="${C.accent}" opacity=".55"/>
<path d="M74 44 L74 88 L80 88 L80 44 Z" fill="${C.accent}" opacity=".55"/>
<rect x="30" y="56" width="40" height="9" rx="2.5" fill="${C.stack}" opacity=".5"/>
<rect x="30" y="69" width="40" height="9" rx="2.5" fill="${C.stack}" opacity=".8"/>
<rect x="30" y="82" width="40" height="9" rx="2.5" fill="${C.stackTop}"/>
</g>`;
}

/** Body copy on a fake article, with an optional selected run of lines. */
function article(lines, selFrom, selTo) {
  return lines.map((l, i) => {
    // Starts below the page heading at y=92; at 17px that needs ~26px of
    // clearance, not the 12px an earlier version left.
    const y = 118 + i * 23;
    const on = selFrom !== undefined && i >= selFrom && i <= selTo;
    const wPx = l.length * 6.6;
    return (on ? rect(32, y - 13, Math.min(wPx + 8, W - 76), 19, { r: 3, fill: C.selbg }) : '')
      + text(36, y, l, { size: 13.5, fill: on ? C.selText : C.dim });
  }).join('\n');
}

/** The right-click menu, with the Attic entry highlighted. */
function contextMenu(x, y) {
  const items = ['Copy', 'Search with…', 'Print…'];
  return `
${rect(x, y, 232, 126, { r: 8, fill: C.raised, stroke: C.line })}
${items.map((t, i) => text(x + 14, y + 24 + i * 24, t, { size: 12.5, fill: C.faint })).join('\n')}
<line x1="${x + 8}" y1="${y + 84}" x2="${x + 224}" y2="${y + 84}" stroke="${C.line}"/>
${rect(x + 5, y + 92, 222, 26, { r: 5, fill: C.sel })}
${text(x + 14, y + 110, 'Stash selection to attic', { size: 12.5, fill: '#fff', weight: 600 })}
<path d="M${x + 214} ${y + 100} l5 5 l-5 5" stroke="#fff" stroke-width="1.5" fill="none"/>`;
}

/** A macOS-style notification. */
function toast(x, y, title, body) {
  return `
${rect(x, y, 300, 62, { r: 10, fill: C.raised, stroke: C.line })}
${atticIcon(x + 14, y + 16, false)}
${text(x + 52, y + 27, title, { size: 12.5, weight: 600 })}
${text(x + 52, y + 46, body, { size: 12, fill: C.good, font: C.mono })}`;
}

// ===========================================================================
// GIF 1 — clip
// ===========================================================================
function clipScenes() {
  const page = [
    'Redis evicts keys when maxmemory is reached. The policy',
    'is set by maxmemory-policy, which defaults to noeviction.',
    '',
    'allkeys-lru evicts any key, including ones with no TTL.',
    'If you store sessions in the same instance as your cache,',
    'session keys become eviction candidates and users are',
    'logged out at random.',
    '',
    'Use volatile-lru to restrict eviction to keys with a TTL.',
  ];

  const S = [];

  // 1 — a page worth keeping
  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page)}
${caption(1, 'You are reading the answer to something.')}`));

  // 2 — selection
  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page, 3, 6)}
${caption(2, 'Select the part that matters.')}`));

  // 3 — right-click
  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page, 3, 6)}
${contextMenu(300, 208)}
${caption(3, 'Right-click → Stash selection to attic.')}`));

  // 4 — written, with the notification
  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page, 3, 6)}
${toast(W - 340, 96, 'Stashed to attic', 'attic:redis-eviction-sessions')}
${caption(4, 'It is written. No form, no filename, no tab switch.')}`));

  // 5 — the file on disk, in the project the agent reads
  S.push(svg(`
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.panel, stroke: C.line })}
<circle cx="38" cy="40" r="6" fill="#ff5f56"/><circle cx="58" cy="40" r="6" fill="#ffbd2e"/><circle cx="78" cy="40" r="6" fill="#27c93f"/>
${text(102, 45, 'your project', { size: 12, fill: C.dim })}
<line x1="14" y1="66" x2="${W - 14}" y2="66" stroke="${C.line}"/>
${[
    { t: '.attic/items/redis-eviction-sessions.md', c: C.good, b: 1 },
    { t: '' },
    { t: '---' },
    { t: 'title: Redis eviction and sessions' },
    { t: 'kind: note' },
    { t: 'tags: [redis, sessions]' },
    { t: '---' },
    { t: '' },
    { t: 'Source: https://redis.io/docs/reference/eviction', c: C.accent },
    { t: '' },
    { t: 'allkeys-lru evicts any key, including ones with no TTL.' },
    { t: 'Session keys become eviction candidates and users are' },
    { t: 'logged out at random.' },
  ].map((l, i) => text(36, 100 + i * 21, l.t, {
    size: 12.5, font: C.mono, fill: l.c || C.dim, weight: l.b ? 600 : undefined,
  })).join('\n')}
${caption(5, 'Same .attic/ your agent reads. Same format, same secret scan.')}`));

  // 6 — the payoff: the agent answers from it
  S.push(svg(`
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.panel, stroke: C.line })}
<circle cx="38" cy="40" r="6" fill="#ff5f56"/><circle cx="58" cy="40" r="6" fill="#ffbd2e"/><circle cx="78" cy="40" r="6" fill="#27c93f"/>
${text(102, 45, 'claude code', { size: 12, fill: C.dim })}
<line x1="14" y1="66" x2="${W - 14}" y2="66" stroke="${C.line}"/>
${[
    { t: '> why are users logged out at random?', c: C.accent },
    { t: '' },
    { t: 'attic:redis-eviction-sessions · allkeys-lru evicts', c: C.good },
    { t: 'any key, including session keys with no TTL.', c: C.text },
    { t: '' },
    { t: 'Fix: volatile-lru, or move sessions to their own', c: C.text },
    { t: 'instance.', c: C.text },
    { t: '' },
    { t: 'no files read, no search', c: C.warn },
  ].map((l, i) => text(36, 108 + i * 24, l.t, { size: 13.5, font: C.mono, fill: l.c || C.dim })).join('\n')}
${caption(6, 'Next session, it already knows.')}`));

  return { scenes: S, holds: [1.8, 1.6, 2.2, 2.4, 3.0, 3.4] };
}

// ===========================================================================
// GIF 2 — library
// ===========================================================================

// Trim to a word boundary rather than mid-word, which looks like a rendering
// fault rather than a deliberate truncation.
function clamp(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** The library's three-pane shell, with one pane's content passed in. */
function shell(main, { navOn = 0, q = '' } = {}) {
  const navs = ['All items', 'Pinned', 'Decisions', 'Links', 'Health'];
  const counts = ['24', '3', '9', '11', '✓'];
  const cards = [
    { s: 'redis-eviction-sessions', k: 'note', h: 'allkeys-lru evicts session keys with no TTL' },
    { s: 'cache-no-ttl', k: 'finding', h: 'get() never checks the stored timestamp' },
    { s: 'auth-token-refresh', k: 'decision', h: 'refresh on 401, not on a timer' },
    { s: 'why-we-dropped-sse', k: 'decision', h: 'proxies buffered it; polling was honest' },
  ];
  const kindFill = { note: C.good, finding: C.violet, decision: C.accent };
  return `
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.bg, stroke: C.line })}
${rect(14, 14, W - 28, 44, { r: 9, fill: C.panel })}
${rect(14, 44, W - 28, 14, { r: 0, fill: C.panel })}
${atticIcon(28, 22, false)}
${text(64, 42, 'Attic', { size: 14, weight: 600 })}
${rect(112, 24, 300, 24, { r: 6, fill: C.bg, stroke: q ? C.accent : C.line })}
${text(124, 41, q || 'Search titles, hooks, bodies…', { size: 12, fill: q ? C.text : C.faint, font: q ? C.mono : C.sans })}
${rect(W - 150, 24, 74, 24, { r: 6, fill: C.accent })}
${text(W - 113, 41, 'Clip tab', { size: 12, weight: 600, fill: '#fff', anchor: 'middle' })}
<line x1="14" y1="58" x2="${W - 14}" y2="58" stroke="${C.line}"/>

<!-- nav rail -->
${rect(14, 58, 150, H - 118, { r: 0, fill: C.panel })}
${navs.map((n, i) => {
    const y = 74 + i * 26;
    return (i === navOn ? rect(20, y - 2, 138, 24, { r: 5, fill: C.navOn }) : '')
      + text(30, y + 14, n, { size: 12.5, fill: i === navOn ? C.accent : C.dim, weight: i === navOn ? 600 : undefined })
      + text(150, y + 14, counts[i], { size: 11, fill: i === navOn ? C.accent : C.faint, anchor: 'end' });
  }).join('\n')}
${text(30, 226, 'KIND', { size: 9.5, fill: C.faint, weight: 600 })}
${['finding 6', 'decision 9', 'note 7'].map((k, i) =>
    `<circle cx="34" cy="${244 + i * 22}" r="3.5" fill="${[C.violet, C.accent, C.good][i]}"/>` +
    text(46, 248 + i * 22, k, { size: 12, fill: C.dim })).join('\n')}
${text(30, 330, 'TAGS', { size: 9.5, fill: C.faint, weight: 600 })}
${['redis 4', 'auth 3', 'perf 2'].map((t, i) => {
    const x = 26 + (i % 2) * 62, y = 342 + Math.floor(i / 2) * 26;
    return rect(x, y, 56, 20, { r: 10, fill: C.bg, stroke: C.line }) + text(x + 28, y + 14, t, { size: 10.5, fill: C.dim, anchor: 'middle' });
  }).join('\n')}
<line x1="164" y1="58" x2="164" y2="${H - 60}" stroke="${C.line}"/>

<!-- list -->
${cards.map((c, i) => {
    const y = 66 + i * 62;
    const on = i === 0;
    return (on ? rect(164, y, 236, 60, { r: 0, fill: C.cardOn }) : '')
      + (on ? `<rect x="164" y="${y}" width="3" height="60" fill="${C.accent}"/>` : '')
      + text(178, y + 20, c.s, { size: 11.5, font: C.mono, fill: on ? C.accent : C.text })
      + text(178, y + 38, clamp(c.h, 34), { size: 10.5, fill: C.dim })
      + rect(178, y + 44, 8 + c.k.length * 5.6, 13, { r: 3, fill: 'none', stroke: kindFill[c.k] })
      + text(182, y + 54, c.k.toUpperCase(), { size: 8, fill: kindFill[c.k], weight: 600 });
  }).join('\n')}
<line x1="400" y1="58" x2="400" y2="${H - 60}" stroke="${C.line}"/>

${main}`;
}

function libraryScenes() {
  const S = [];

  // 1 — the shell, reading an item as rendered markdown
  const reader = `
${text(420, 88, 'Redis eviction and sessions', { size: 17, weight: 700 })}
${rect(420, 100, 44, 15, { r: 3, fill: 'none', stroke: C.good })}
${text(424, 111, 'NOTE', { size: 8, fill: C.good, weight: 600 })}
${text(474, 111, '2026-09-12', { size: 10.5, fill: C.faint })}
${rect(540, 99, 172, 17, { r: 3, fill: C.navOn })}
${text(548, 111, 'attic:redis-eviction-sessions', { size: 9, font: C.mono, fill: C.accent })}
<line x1="420" y1="126" x2="${W - 30}" y2="126" stroke="${C.line}"/>
${text(420, 150, 'Why sessions vanish', { size: 14, weight: 600 })}
<line x1="420" y1="158" x2="${W - 30}" y2="158" stroke="${C.line}"/>
${[
    'allkeys-lru evicts any key, including ones with',
    'no TTL. Session keys become candidates and users',
    'are logged out at random.',
  ].map((l, i) => text(420, 180 + i * 20, l, { size: 12.5, fill: C.dim })).join('\n')}
${rect(420, 248, 250, 46, { r: 6, fill: C.panel, stroke: C.line })}
${text(432, 268, 'maxmemory-policy volatile-lru', { size: 11.5, font: C.mono, fill: C.text })}
${text(432, 285, 'redis.conf', { size: 9.5, font: C.mono, fill: C.faint })}
${text(420, 320, 'See also', { size: 12.5, fill: C.dim })}
${rect(478, 308, 96, 16, { r: 4, fill: C.navOn })}
${text(484, 320, 'cache-no-ttl', { size: 10, font: C.mono, fill: C.accent })}
${text(420, 360, 'LINKED FROM', { size: 9.5, fill: C.faint, weight: 600 })}
${rect(420, 370, 300, 26, { r: 5, fill: C.panel, stroke: C.line })}
${text(432, 387, 'auth-token-refresh', { size: 10.5, font: C.mono, fill: C.accent })}`;
  S.push(svg(`${shell(reader)}${caption(1, 'Items read as documents, not raw text.')}`));

  // 2 — wikilinks
  S.push(svg(`${shell(`${reader}
${rect(474, 304, 104, 24, { r: 6, fill: 'none', stroke: C.accent, sw: 2 })}
${text(600, 322, '← [[slug]] links items', { size: 12, fill: C.accent, weight: 600 })}`)}
${caption(2, '[[slug]] links items, and each shows what links back.')}`));

  // 3 — search across bodies
  S.push(svg(`${shell(`
${text(420, 92, '2 of 24', { size: 11.5, fill: C.dim })}
${[
    { s: 'redis-eviction-sessions', pre: 'allkeys-lru evicts any key including ', hit: 'session', post: ' keys' },
    { s: 'auth-token-refresh', pre: 'refresh on 401 so a stale ', hit: 'session', post: ' recovers' },
  ].map((r, i) => {
    const y = 120 + i * 64;
    return rect(420, y, W - 450, 52, { r: 6, fill: C.panel, stroke: C.line })
      + text(434, y + 22, r.s, { size: 11.5, font: C.mono, fill: C.accent })
      + text(434, y + 40, r.pre, { size: 11, fill: C.dim })
      + rect(434 + r.pre.length * 5.5, y + 29, r.hit.length * 6.2, 14, { r: 2, fill: C.mark })
      + text(436 + r.pre.length * 5.5, y + 40, r.hit, { size: 11, fill: C.text })
      + text(438 + (r.pre.length + r.hit.length) * 5.6, y + 40, r.post, { size: 11, fill: C.dim });
  }).join('\n')}`, { q: 'session' })}
${caption(3, 'Search reaches full bodies, with the match in context.')}`));

  // 4 — the command palette
  S.push(svg(`${shell(reader)}
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.scrim, opacity: C.scrimAlpha })}
${rect(230, 70, 440, 250, { r: 12, fill: C.raised, stroke: C.line })}
${text(252, 104, 'Jump to an item, or type a command…', { size: 14, fill: C.faint })}
<line x1="230" y1="120" x2="670" y2="120" stroke="${C.line}"/>
${[
    ['Clip the current tab', 'command'],
    ['Show decisions', 'command'],
    ['redis-eviction-sessions', 'note'],
    ['cache-no-ttl', 'finding'],
    ['why-we-dropped-sse', 'decision'],
  ].map((r, i) => {
    const y = 130 + i * 36;
    return (i === 0 ? rect(230, y, 440, 34, { r: 0, fill: C.cardOn }) : '')
      + text(252, y + 22, r[0], { size: 12.5, font: i > 1 ? C.mono : C.sans, fill: i === 0 ? C.accent : C.text })
      + text(650, y + 22, r[1], { size: 10.5, fill: C.faint, anchor: 'end' });
  }).join('\n')}
${caption(4, '⌘K jumps to any item, or runs a command.')}`));

  // 5 — the overview
  S.push(svg(`${shell(`
${text(420, 90, 'This attic', { size: 17, weight: 700 })}
${[['24', 'items'], ['9', 'decisions'], ['3', 'pinned'], ['11', 'tags']].map((s, i) => {
    const x = 420 + (i % 4) * 115;
    return rect(x, 106, 105, 56, { r: 6, fill: C.panel, stroke: C.line })
      + text(x + 14, 136, s[0], { size: 22, weight: 700 })
      + text(x + 14, 152, s[1], { size: 10.5, fill: C.dim });
  }).join('\n')}
${text(420, 190, 'BY KIND', { size: 9.5, fill: C.faint, weight: 600 })}
${[[C.violet, 0, 120], [C.accent, 120, 180], [C.good, 300, 140]].map(([c, x, w]) =>
    `<rect x="${420 + x}" y="200" width="${w}" height="8" fill="${c}"/>`).join('\n')}
${text(420, 240, 'LATEST DECISIONS', { size: 9.5, fill: C.faint, weight: 600 })}
<line x1="424" y1="250" x2="424" y2="340" stroke="${C.line}" stroke-width="2"/>
${[
    ['2026-09-12', 'Archive, never delete, from the browser'],
    ['2026-09-11', 'refresh on 401, not on a timer'],
  ].map((d, i) => {
    const y = 268 + i * 44;
    return `<circle cx="424" cy="${y - 4}" r="4" fill="${C.accent}" stroke="${C.bg}" stroke-width="2"/>`
      + text(440, y, d[0], { size: 10, font: C.mono, fill: C.faint })
      + text(440, y + 17, d[1], { size: 12, fill: C.text });
  }).join('\n')}`, { navOn: 0 })}
${caption(5, 'An overview of what the attic actually holds.')}`));

  // 6 — editing
  S.push(svg(`${shell(`
${text(420, 90, 'Editing redis-eviction-sessions', { size: 15, weight: 600 })}
${text(420, 118, 'Body · markdown, and [[slug]] links to another item', { size: 10.5, fill: C.dim })}
${rect(420, 128, W - 450, 180, { r: 6, fill: C.bg, stroke: C.accent })}
${[
    'allkeys-lru evicts any key, including ones',
    'with no TTL.',
    '',
    'Fix: volatile-lru. See [[cache-no-ttl]] for the',
    'related TTL bug.',
  ].map((l, i) => text(434, 152 + i * 21, l, { size: 11.5, font: C.mono, fill: C.text })).join('\n')}
${rect(420, 324, 104, 30, { r: 6, fill: C.accent })}
${text(472, 344, 'Save changes', { size: 12, weight: 600, fill: '#fff', anchor: 'middle' })}
${text(536, 344, 'replaces the body — it does not append', { size: 11, fill: C.dim })}`)}
${caption(6, 'Edit in place. Pin it. Archive it — nothing is deleted.')}`));

  return { scenes: S, holds: [2.6, 2.2, 2.6, 2.4, 2.8, 3.0] };
}


// ===========================================================================
// HERO — the whole product in one pass.
//
// Folds in what assets/demo.gif used to say on its own (stash -> /compact ->
// still knows -> Codex) and continues into the browser half, so the top of
// the README tells one story rather than three overlapping ones.
// ===========================================================================

/** A terminal window. The agent half of the story lives in these. */
function term(lines, host) {
  return `
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.panel, stroke: C.line })}
<circle cx="38" cy="40" r="6" fill="#ff5f56"/><circle cx="58" cy="40" r="6" fill="#ffbd2e"/><circle cx="78" cy="40" r="6" fill="#27c93f"/>
${text(102, 45, host || 'claude code', { size: 12, fill: C.dim })}
<line x1="14" y1="66" x2="${W - 14}" y2="66" stroke="${C.line}"/>
${lines.map((l, i) => text(36, 100 + i * 24, l.t, {
    size: 13.5, font: C.mono, fill: l.c || C.dim, weight: l.b ? 600 : undefined,
  })).join('\n')}`;
}

function heroScenes() {
  const S = [];
  const page = [
    'allkeys-lru evicts any key, including ones with no TTL.',
    'If you store sessions in the same instance as your cache,',
    'session keys become eviction candidates and users are',
    'logged out at random.',
  ];

  // --- the agent half -----------------------------------------------------
  S.push(svg(`${term([
    { t: '> why are users logged out at random?', c: C.accent },
    { t: '' },
    { t: '  Read src/session.ts' },
    { t: '  Grep "maxmemory"' },
    { t: '  Read redis.conf …' },
  ])}${caption(1, 'Your agent works something out.')}`));

  S.push(svg(`${term([
    { t: '> why are users logged out at random?', c: C.accent },
    { t: '' },
    { t: '  Read src/session.ts' },
    { t: '  Grep "maxmemory"' },
    { t: '  Read redis.conf …' },
    { t: '' },
    { t: 'attic:redis-eviction · allkeys-lru evicts session', c: C.good, b: 1 },
    { t: 'keys, which have no TTL.', c: C.text },
  ])}${caption(2, 'It is written down, not just said.')}`));

  S.push(svg(`${term([
    { t: '.attic/', c: C.text },
    { t: '  INDEX.md            + 1 line', c: C.good },
    { t: '  items/redis-eviction.md', c: C.good },
    { t: '' },
    { t: '> /compact', c: C.accent },
    { t: '  context cleared …' },
  ])}${caption(3, 'Context is compacted. The chat history is gone.')}`));

  S.push(svg(`${term([
    { t: '> what was that redis problem?', c: C.accent },
    { t: '' },
    { t: 'attic:redis-eviction · allkeys-lru evicts session', c: C.good, b: 1 },
    { t: 'keys, which have no TTL. Fix: volatile-lru.', c: C.text },
    { t: '' },
    { t: 'no files read', c: C.warn },
  ])}${caption(4, 'It still knows. Nothing was re-read.')}`));

  // --- the browser half ---------------------------------------------------
  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page, 0, 3)}
${contextMenu(320, 190)}
${caption(5, 'The answer is often in a tab. Select it, right-click.')}`));

  S.push(svg(`
${chrome_('redis.io/docs/reference/eviction')}
${text(32, 92, 'Key eviction', { size: 17, weight: 700 })}
${article(page, 0, 3)}
${toast(W - 340, 96, 'Stashed to attic', 'attic:redis-eviction-sessions')}
${caption(6, 'Same attic. No form, no filename, no tab switch.')}`));

  // --- the library --------------------------------------------------------
  const reader = `
${text(420, 88, 'Redis eviction and sessions', { size: 17, weight: 700 })}
${rect(420, 100, 44, 15, { r: 3, fill: 'none', stroke: C.good })}
${text(424, 111, 'NOTE', { size: 8, fill: C.good, weight: 600 })}
${text(474, 111, '2026-09-12', { size: 10.5, fill: C.faint })}
${rect(540, 99, 172, 17, { r: 3, fill: C.navOn })}
${text(548, 111, 'attic:redis-eviction-sessions', { size: 9, font: C.mono, fill: C.accent })}
<line x1="420" y1="126" x2="${W - 30}" y2="126" stroke="${C.line}"/>
${text(420, 150, 'Why sessions vanish', { size: 14, weight: 600 })}
<line x1="420" y1="158" x2="${W - 30}" y2="158" stroke="${C.line}"/>
${[
    'allkeys-lru evicts any key, including ones with',
    'no TTL. Session keys become candidates and users',
    'are logged out at random.',
  ].map((l, i) => text(420, 180 + i * 20, l, { size: 12.5, fill: C.dim })).join('\n')}
${rect(420, 248, 250, 46, { r: 6, fill: C.panel, stroke: C.line })}
${text(432, 268, 'maxmemory-policy volatile-lru', { size: 11.5, font: C.mono, fill: C.text })}
${text(432, 285, 'redis.conf', { size: 9.5, font: C.mono, fill: C.faint })}
${text(420, 320, 'See also', { size: 12.5, fill: C.dim })}
${rect(478, 308, 96, 16, { r: 4, fill: C.navOn })}
${text(484, 320, 'cache-no-ttl', { size: 10, font: C.mono, fill: C.accent })}
${text(420, 360, 'LINKED FROM', { size: 9.5, fill: C.faint, weight: 600 })}
${rect(420, 370, 300, 26, { r: 5, fill: C.panel, stroke: C.line })}
${text(432, 387, 'auth-token-refresh', { size: 10.5, font: C.mono, fill: C.accent })}`;

  S.push(svg(`${shell(reader)}${caption(7, 'A library over your attic: markdown, and [[slug]] links.')}`));

  S.push(svg(`${shell(reader)}
${rect(14, 14, W - 28, H - 62, { r: 9, fill: C.scrim, opacity: C.scrimAlpha })}
${rect(230, 90, 440, 214, { r: 12, fill: C.raised, stroke: C.line })}
${text(252, 124, 'Jump to an item, or type a command…', { size: 14, fill: C.faint })}
<line x1="230" y1="140" x2="670" y2="140" stroke="${C.line}"/>
${[
    ['Clip the current tab', 'command'],
    ['redis-eviction-sessions', 'note'],
    ['cache-no-ttl', 'finding'],
    ['why-we-dropped-sse', 'decision'],
  ].map((r, i) => {
    const y = 150 + i * 36;
    return (i === 0 ? rect(230, y, 440, 34, { r: 0, fill: C.cardOn }) : '')
      + text(252, y + 22, r[0], { size: 12.5, font: i > 0 ? C.mono : C.sans, fill: i === 0 ? C.accent : C.text })
      + text(650, y + 22, r[1], { size: 10.5, fill: C.faint, anchor: 'end' });
  }).join('\n')}
${caption(8, '⌘K to jump. Search, edit, pin — nothing is deleted.')}`));

  // --- the point ----------------------------------------------------------
  S.push(svg(`${term([
    { t: '$attic-recall redis', c: C.accent },
    { t: '' },
    { t: 'attic:redis-eviction-sessions · allkeys-lru evicts', c: C.good, b: 1 },
    { t: 'session keys, which have no TTL.', c: C.text },
    { t: '' },
    { t: 'same .attic/, different agent', c: C.warn },
  ], 'codex')}${caption(9, 'One folder. Your agent, your browser, either CLI.')}`));

  return { scenes: S, holds: [1.9, 2.6, 2.2, 2.8, 2.6, 2.4, 2.9, 2.6, 3.2] };
}

// ---------------------------------------------------------------------------
function write(name, { scenes, holds }) {
  const dir = path.join(OUT, `frames-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  scenes.forEach((s, i) => fs.writeFileSync(path.join(dir, `scene${i}.svg`), s));
  // Written next to the frames so make-gif.sh needs no per-GIF knowledge.
  fs.writeFileSync(path.join(dir, 'holds.json'), JSON.stringify(holds));
  fs.writeFileSync(path.join(dir, 'size.json'), JSON.stringify({ w: W, h: H }));
  console.log(`wrote ${scenes.length} frames to assets/frames-${name}/`);
}

/**
 * Build one GIF's frames in one theme.
 *
 * The palette is swapped before the scenes are built, not after: every helper
 * reads `C` at draw time, so a scene function captures whichever theme is
 * current. Building both themes therefore means calling the scene function
 * twice, not recolouring its output.
 */
function render(name, scenesFn, theme) {
  C = { ...THEMES[theme], ...FONTS };
  write(theme === 'dark' ? name : `${name}-${theme}`, scenesFn());
}

// A hex literal outside the THEMES table is a colour the light build cannot
// swap — which is exactly how the selected card came out dark navy on a white
// page. The traffic lights and pure white on an accent fill are the only
// legitimate constants, so they are named here rather than silently allowed.
function assertNoStrayHex() {
  const src = fs.readFileSync(__filename, 'utf8');
  const body = src.slice(src.indexOf('const esc =')); // skip the THEMES table
  const allowed = new Set(['#ff5f56', '#ffbd2e', '#27c93f', '#fff', '#ffffff']);
  const stray = [...new Set([...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]))]
    .filter((h) => !allowed.has(h.toLowerCase()));
  if (stray.length) {
    console.error(`error: hard-coded colour(s) outside THEMES: ${stray.join(', ')}`);
    console.error('       these will not swap when the light build runs.');
    process.exit(1);
  }
}
assertNoStrayHex();

for (const theme of ['dark', 'light']) {
  render('hero', heroScenes, theme);
  render('clip', clipScenes, theme);
  render('library', libraryScenes, theme);
}
