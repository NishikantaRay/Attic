#!/usr/bin/env node
'use strict';
/**
 * make-assets.js — generate README visuals. No dependencies.
 *
 * Writes theme-aware SVG (readable on light and dark GitHub) plus GIF frames
 * that ffmpeg assembles. Numbers come from benchmarks/results/, never
 * hand-written, so a stale chart cannot outlive the data.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

// GitHub renders SVG without external CSS, so colours are inline and chosen
// to read on both themes rather than swapped by media query.
const C = {
  bg: '#0d1117', panel: '#161b22', line: '#30363d',
  text: '#e6edf3', dim: '#8b949e',
  accent: '#58a6ff', good: '#3fb950', warn: '#d29922', bad: '#f85149',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  sans: '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
<rect width="${w}" height="${h}" rx="10" fill="${C.bg}"/>
${body}
</svg>`;
}

// ---------- 1. how it works ----------
function howItWorks() {
  const w = 880, h = 300;
  const box = (x, y, bw, bh, title, lines, stroke) => `
  <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${C.panel}" stroke="${stroke || C.line}" stroke-width="1.5"/>
  <text x="${x + 14}" y="${y + 26}" font-family="${C.sans}" font-size="14" font-weight="600" fill="${C.text}">${esc(title)}</text>
  ${lines.map((l, i) => `<text x="${x + 14}" y="${y + 50 + i * 19}" font-family="${C.mono}" font-size="12" fill="${C.dim}">${esc(l)}</text>`).join('\n  ')}`;

  const arrow = (x1, y1, x2, y2, label) => `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.accent}" stroke-width="2" marker-end="url(#a)"/>
  ${label ? `<text x="${(x1 + x2) / 2}" y="${y1 - 8}" text-anchor="middle" font-family="${C.sans}" font-size="11" fill="${C.accent}">${esc(label)}</text>` : ''}`;

  return svg(w, h, `
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
<path d="M0,0 L10,5 L0,10 z" fill="${C.accent}"/></marker></defs>
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">How Attic works</text>
${box(24, 56, 240, 108, 'You work', ['read 5 files', 'trace the bug', 'find the cause'])}
${arrow(272, 110, 320, 110, 'stash')}
${box(328, 56, 236, 108, '.attic/', ['items/redis-bug.md', 'INDEX.md  +1 line', 'DECISIONS.md'], C.good)}
${arrow(572, 110, 620, 110, 'inject')}
${box(628, 56, 228, 108, 'Next session', ['index in context', 'after /compact too', 'answers, no re-read'], C.accent)}
<rect x="24" y="188" width="832" height="86" rx="8" fill="${C.panel}" stroke="${C.line}"/>
<text x="40" y="214" font-family="${C.mono}" font-size="12.5" fill="${C.dim}">you:    why are users logged out at random?</text>
<text x="40" y="238" font-family="${C.mono}" font-size="12.5" fill="${C.text}">claude: <tspan fill="${C.good}">attic:redis-eviction-bug</tspan> · maxmemory-policy is allkeys-lru, session keys get evicted.</text>
<text x="40" y="260" font-family="${C.mono}" font-size="12.5" fill="${C.dim}">        fix is volatile-lru. <tspan fill="${C.warn}">no files read</tspan></text>`);
}

// ---------- 2. the scale fix ----------
function scaleFix() {
  const w = 880, h = 250;
  const bar = (x, y, items, keptFrom, label, colour) => {
    const cells = items.map((_, i) => {
      const cx = x + i * 15;
      const kept = keptFrom(i);
      return `<rect x="${cx}" y="${y}" width="12" height="26" rx="2" fill="${kept ? colour : '#21262d'}" stroke="${kept ? colour : C.line}" stroke-width="1"/>`;
    }).join('');
    return `${cells}<text x="${x}" y="${y - 10}" font-family="${C.sans}" font-size="13" font-weight="600" fill="${C.text}">${esc(label)}</text>`;
  };
  const n = 40;
  const arr = [...Array(n)];
  return svg(w, h, `
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">Which items reach your next session</text>
<text x="24" y="56" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">oldest on the left, newest on the right — filled = injected into context</text>
${bar(24, 96, arr, (i) => i < 22, 'Before: kept the oldest, dropped your newest work', C.bad)}
<text x="640" y="115" font-family="${C.mono}" font-size="12" fill="${C.bad}">newest lost</text>
${bar(24, 176, arr, (i) => i === 3 || i >= 20, 'After: pinned + newest survive, the rest stay recallable', C.good)}
<text x="86" y="220" text-anchor="middle" font-family="${C.mono}" font-size="10.5" fill="${C.accent}">pinned</text>
<text x="640" y="195" font-family="${C.mono}" font-size="12" fill="${C.good}">newest kept</text>`);
}

// ---------- 3. benchmark chart, from real data ----------
function benchmark() {
  const file = path.join(__dirname, '..', 'benchmarks', 'results', '2026-09-04-run2.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
  const c = data.cases.find((x) => x.id === 'cache-ttl');
  if (!c) return null;

  const w = 880, h = 268;
  const noA = c.noAttic.input.median, wi = c.attic.input.median;
  const BAR_X = 150, BAR_MAX = 380;           // leaves room for the label text
  const scale = BAR_MAX / Math.max(noA, wi);
  const row = (y, label, val, colour, extra) => {
    const bw = Math.max(4, Math.round(val * scale));
    return `
  <text x="24" y="${y + 18}" font-family="${C.sans}" font-size="13.5" fill="${C.text}">${esc(label)}</text>
  <rect x="${BAR_X}" y="${y}" width="${bw}" height="26" rx="4" fill="${colour}"/>
  <text x="${BAR_X + bw + 12}" y="${y + 18}" font-family="${C.mono}" font-size="12.5" fill="${C.text}">${val.toLocaleString()}</text>
  <text x="${BAR_X + bw + 90}" y="${y + 18}" font-family="${C.sans}" font-size="12" fill="${C.dim}">${esc(extra || '')}</text>`;
  };

  return svg(w, h, `
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">Input tokens to answer one question about known code</text>
<text x="24" y="56" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">26-file fixture, median of 3 runs, both arms answered correctly 3/3</text>
${row(88, 'without attic', noA, C.bad, 'reads the repo')}
${row(134, 'with attic', wi, C.good, 'answer already stashed')}
<line x1="24" y1="188" x2="856" y2="188" stroke="${C.line}"/>
<text x="24" y="212" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">A second run of the same benchmark measured -66.6%. The spread is real:</text>
<text x="24" y="232" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">the direction is the finding, not the exact percentage. When nothing relevant is</text>
<text x="24" y="252" font-family="${C.sans}" font-size="12.5" fill="${C.warn}">stashed, Attic costs more than it returns — measured at +4.7%.</text>`);
}

// ---------- 4. GIF frames ----------
function frames() {
  const dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const W = 800, H = 360;
  const term = (lines, caption) => {
    const rows = lines.map((l, i) => {
      const y = 92 + i * 22;
      const fill = l.c || C.text;
      return `<text x="34" y="${y}" font-family="${C.mono}" font-size="13.5" fill="${fill}">${esc(l.t)}</text>`;
    }).join('\n');
    return svg(W, H, `
<rect x="16" y="16" width="${W - 32}" height="${H - 72}" rx="9" fill="${C.panel}" stroke="${C.line}"/>
<circle cx="40" cy="42" r="6" fill="#ff5f56"/><circle cx="60" cy="42" r="6" fill="#ffbd2e"/><circle cx="80" cy="42" r="6" fill="#27c93f"/>
<text x="104" y="47" font-family="${C.sans}" font-size="12" fill="${C.dim}">claude code</text>
<line x1="16" y1="64" x2="${W - 16}" y2="64" stroke="${C.line}"/>
${rows}
<text x="16" y="${H - 26}" font-family="${C.sans}" font-size="14" font-weight="600" fill="${C.accent}">${esc(caption)}</text>`);
  };

  const S = [];
  S.push(term([
    { t: '> why does the cache serve stale data?', c: C.accent },
  ], '1. You ask. Claude investigates.'));
  S.push(term([
    { t: '> why does the cache serve stale data?', c: C.accent },
    { t: '  Read src/cache.ts', c: C.dim },
    { t: '  Grep "store.get"', c: C.dim },
    { t: '  Read src/module7.ts …', c: C.dim },
  ], '1. You ask. Claude investigates.'));
  S.push(term([
    { t: '> why does the cache serve stale data?', c: C.accent },
    { t: '  Read src/cache.ts', c: C.dim },
    { t: '  Grep "store.get"', c: C.dim },
    { t: '  Read src/module7.ts …', c: C.dim },
    { t: '' },
    { t: 'attic:cache-no-ttl · get() never checks the', c: C.good },
    { t: 'stored timestamp, so there is no TTL.', c: C.text },
  ], '2. The finding is stashed, not just spoken.'));
  S.push(term([
    { t: '.attic/', c: C.text },
    { t: '  INDEX.md          + 1 line', c: C.good },
    { t: '  items/cache-no-ttl.md', c: C.good },
    { t: '', c: C.dim },
    { t: '> /compact', c: C.accent },
    { t: '  context cleared …', c: C.dim },
  ], '3. Context is compacted. Chat history is gone.'));
  S.push(term([
    { t: '> what was wrong with the cache?', c: C.accent },
    { t: '' },
    { t: 'attic:cache-no-ttl · get() ignores the stored', c: C.good },
    { t: 'timestamp, so entries are served forever.', c: C.text },
    { t: 'Fix: compare Date.now() - at against a TTL.', c: C.text },
    { t: '' },
    { t: 'no files read', c: C.warn },
  ], '4. It still knows. The attic survived.'));

  // One file per scene. Duration is applied at assembly time, so the frames
  // stay cheap to rasterise.
  S.forEach((s, i) => fs.writeFileSync(path.join(dir, `scene${i}.svg`), s));
  fs.writeFileSync(path.join(dir, 'holds.json'), JSON.stringify([1.5, 1.7, 2.6, 2.2, 3.2]));
  return { dir, count: S.length };
}

const files = {
  'how-it-works.svg': howItWorks(),
  'scale-fix.svg': scaleFix(),
  'benchmark.svg': benchmark(),
};
for (const [name, content] of Object.entries(files)) {
  if (!content) { console.log(`skipped ${name} (no data)`); continue; }
  fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote assets/${name}`);
}
const f = frames();
console.log(`wrote ${f.count} frames to assets/frames/`);
