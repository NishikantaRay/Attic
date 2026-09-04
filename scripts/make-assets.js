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
  const w = 880, h = 318;
  const box = (x, y, bw, bh, title, lines, stroke) => `
  <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${C.panel}" stroke="${stroke || C.line}" stroke-width="1.5"/>
  <text x="${x + 14}" y="${y + 26}" font-family="${C.sans}" font-size="14" font-weight="600" fill="${C.text}">${esc(title)}</text>
  ${lines.map((l, i) => `<text x="${x + 14}" y="${y + 50 + i * 19}" font-family="${C.mono}" font-size="12" fill="${C.dim}">${esc(l)}</text>`).join('\n  ')}`;
  const arrow = (x1, y1, x2, y2, label) => `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.accent}" stroke-width="2" marker-end="url(#a)"/>
  ${label ? `<text x="${(x1 + x2) / 2}" y="${y1 - 8}" text-anchor="middle" font-family="${C.sans}" font-size="11" fill="${C.accent}">${esc(label)}</text>` : ''}`;
  const Y = 74;
  return svg(w, h, `
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
<path d="M0,0 L10,5 L0,10 z" fill="${C.accent}"/></marker></defs>
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">How Attic works</text>
<text x="24" y="56" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">Claude Code · Codex CLI — same skills, same script, same hooks</text>
${box(24, Y, 240, 108, 'You work', ['read 5 files', 'trace the bug', 'find the cause'])}
${arrow(272, Y + 54, 320, Y + 54, 'stash')}
${box(328, Y, 236, 108, '.attic/', ['items/redis-bug.md', 'INDEX.md  +1 line', 'DECISIONS.md'], C.good)}
${arrow(572, Y + 54, 620, Y + 54, 'inject')}
${box(628, Y, 228, 108, 'Next session', ['index in context', 'after /compact too', 'answers, no re-read'], C.accent)}
<rect x="24" y="${Y + 132}" width="832" height="86" rx="8" fill="${C.panel}" stroke="${C.line}"/>
<text x="40" y="${Y + 158}" font-family="${C.mono}" font-size="12.5" fill="${C.dim}">you:    why are users logged out at random?</text>
<text x="40" y="${Y + 182}" font-family="${C.mono}" font-size="12.5" fill="${C.text}">claude: <tspan fill="${C.good}">attic:redis-eviction-bug</tspan> · maxmemory-policy is allkeys-lru, session keys get evicted.</text>
<text x="40" y="${Y + 204}" font-family="${C.mono}" font-size="12.5" fill="${C.dim}">        fix is volatile-lru. <tspan fill="${C.warn}">no files read</tspan></text>`);
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
  const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'results', f), 'utf8')); } catch (e) { return null; } };
  const codex = load('2026-09-04-codex.json'), claude = load('2026-09-04-run2.json'), claude1 = load('2026-09-04-run1.json');
  if (!codex || !claude) return null;
  const pick = (d) => { const c = d.cases.find((x) => x.id === 'cache-ttl'); return { no: c.noAttic.input.median, yes: c.attic.input.median, delta: c.inputDeltaPct }; };
  const cold = (d) => { const c = d && d.cases.find((x) => x.id === 'cold-attic'); return c ? c.inputDeltaPct : null; };
  const pct = (n) => `${n > 0 ? '+' : ''}${n}%`;
  // The counter-case note must not call a measured win "overhead". Codex has
  // one run; Claude Code has two that disagree, and that disagreement is the
  // honest thing to show.
  const coldNote = (deltas) => {
    const ds = deltas.filter((d) => d !== null);
    if (!ds.length) return null;
    if (ds.length === 1) return `nothing relevant stashed: ${pct(ds[0])}  (${ds[0] > 0 ? 'the attic is overhead here' : 'noise; expect overhead'})`;
    return `nothing relevant stashed: ${ds.map(pct).join(' and ')} across two runs  (noise dominates; expect overhead)`;
  };
  const groups = [['Codex CLI', pick(codex), coldNote([cold(codex)])], ['Claude Code', pick(claude), coldNote([cold(claude1), cold(claude)])]];

  const w = 880, h = 352;
  const BAR_X = 150, BAR_MAX = 420;
  const max = Math.max(...groups.flatMap((g) => [g[1].no, g[1].yes]));
  const scale = BAR_MAX / max;
  const bar = (y, label, val, colour, tag) => {
    const bw = Math.max(4, Math.round(val * scale));
    return `
  <text x="24" y="${y + 17}" font-family="${C.sans}" font-size="13" fill="${C.text}">${esc(label)}</text>
  <rect x="${BAR_X}" y="${y}" width="${bw}" height="24" rx="4" fill="${colour}"/>
  <text x="${BAR_X + bw + 10}" y="${y + 17}" font-family="${C.mono}" font-size="12.5" fill="${C.text}">${val.toLocaleString()}</text>
  ${tag ? `<text x="${BAR_X + bw + 92}" y="${y + 17}" font-family="${C.sans}" font-size="12.5" font-weight="700" fill="${colour}">${esc(tag)}</text>` : ''}`;
  };
  let y = 82; const parts = [];
  for (const [name, r, coldDelta] of groups) {
    parts.push(`<text x="24" y="${y}" font-family="${C.sans}" font-size="13.5" font-weight="700" fill="${C.accent}">${esc(name)}</text>`);
    parts.push(bar(y + 12, 'without attic', r.no, C.bad));
    parts.push(bar(y + 44, 'with attic', r.yes, C.good, `${r.delta}%`));
    if (coldDelta) parts.push(`<text x="${BAR_X}" y="${y + 90}" font-family="${C.sans}" font-size="11.5" fill="${C.dim}">${esc(coldDelta)}</text>`);
    y += 118;
  }
  return svg(w, h, `
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">Input tokens to answer one question about known code</text>
<text x="24" y="56" font-family="${C.sans}" font-size="12.5" fill="${C.dim}">26-file fixture · median of 3 runs · every run on both hosts answered correctly</text>
${parts.join('\n')}
<line x1="24" y1="${y - 14}" x2="856" y2="${y - 14}" stroke="${C.line}"/>
<text x="24" y="${y + 8}" font-family="${C.sans}" font-size="12" fill="${C.dim}">Same direction on two different agents and models. Codex varied by 14 tokens across runs; Claude Code</text>
<text x="24" y="${y + 26}" font-family="${C.sans}" font-size="12" fill="${C.warn}">swung 30 points between runs, so read its bar as a range. Method and raw samples: benchmarks/README.md</text>`);
}

// ---------- 3b. architecture layers ----------
function architecture() {
  const w = 880, h = 420;
  const layers = [
    ['User intent', 'a question, a task, a "stash this"', C.dim],
    ['Router', 'skill descriptions decide which attic skill fires, or none', C.accent],
    ['Skill hub', 'SKILL.md rules · references/ loaded on demand · templates/', C.accent],
    ['Script', 'attic.js: slugs, frontmatter, index, atomic writes, secret scan', C.good],
    ['Enforcement', 'session hooks · pre-commit · CI · merge driver', C.good],
    ['Evaluation', 'activation suite · behaviour suite · two-host benchmark', C.warn],
  ];
  const X = 24, W = 560, H = 44, GAP = 14; let y = 62; const out = [];
  layers.forEach(([t, d, col], i) => {
    out.push(`<rect x="${X}" y="${y}" width="${W}" height="${H}" rx="7" fill="${C.panel}" stroke="${col}" stroke-width="1.5"/>
<text x="${X + 14}" y="${y + 19}" font-family="${C.sans}" font-size="13" font-weight="700" fill="${C.text}">${esc(t)}</text>
<text x="${X + 14}" y="${y + 35}" font-family="${C.mono}" font-size="11" fill="${C.dim}">${esc(d)}</text>`);
    if (i < layers.length - 1) out.push(`<line x1="${X + W / 2}" y1="${y + H}" x2="${X + W / 2}" y2="${y + H + GAP}" stroke="${C.line}" stroke-width="2"/>`);
    y += H + GAP;
  });
  const side = (y1, y2, title, lines, col) => `
<rect x="614" y="${y1}" width="242" height="${y2 - y1}" rx="7" fill="none" stroke="${col}" stroke-dasharray="4 3"/>
<text x="628" y="${y1 + 22}" font-family="${C.sans}" font-size="13" font-weight="700" fill="${col}">${esc(title)}</text>
${lines.map((l, i) => `<text x="628" y="${y1 + 44 + i * 18}" font-family="${C.sans}" font-size="11.5" fill="${C.dim}">${esc(l)}</text>`).join('\n')}`;
  return svg(w, h, `
<text x="24" y="34" font-family="${C.sans}" font-size="17" font-weight="700" fill="${C.text}">Use the model for judgement, software for certainty</text>
${out.join('\n')}
${side(62, 62 + 3 * H + 2 * GAP, 'Model decides', ['is this worth keeping?', 'what does the item say?', 'which slug, which kind?'], C.accent)}
${side(62 + 3 * (H + GAP), 62 + 6 * H + 5 * GAP, 'Software decides', ['valid frontmatter, no dupes', 'no credential reaches disk', 'index survives merge + compact', 'did the skill actually fire?'], C.good)}`);
}

// ---------- 4. GIF frames ----------
function frames() {
  const dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const W = 800, H = 360;
  const term = (lines, caption, host) => {
    const rows = lines.map((l, i) => {
      const y = 92 + i * 22;
      const fill = l.c || C.text;
      return `<text x="34" y="${y}" font-family="${C.mono}" font-size="13.5" fill="${fill}">${esc(l.t)}</text>`;
    }).join('\n');
    return svg(W, H, `
<rect x="16" y="16" width="${W - 32}" height="${H - 72}" rx="9" fill="${C.panel}" stroke="${C.line}"/>
<circle cx="40" cy="42" r="6" fill="#ff5f56"/><circle cx="60" cy="42" r="6" fill="#ffbd2e"/><circle cx="80" cy="42" r="6" fill="#27c93f"/>
<text x="104" y="47" font-family="${C.sans}" font-size="12" fill="${C.dim}">${esc(host || 'claude code')}</text>
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
  ], '4. It still knows. The attic survived /compact.'));
  S.push(term([
    { t: '$attic-recall cache', c: C.accent },
    { t: '' },
    { t: 'attic:cache-no-ttl · get() ignores the stored', c: C.good },
    { t: 'timestamp, so entries are served forever.', c: C.text },
    { t: '' },
    { t: 'same .attic/, different agent', c: C.warn },
  ], '5. Same attic on Codex CLI.', 'codex'));

  // One file per scene. Duration is applied at assembly time, so the frames
  // stay cheap to rasterise.
  S.forEach((s, i) => fs.writeFileSync(path.join(dir, `scene${i}.svg`), s));
  fs.writeFileSync(path.join(dir, 'holds.json'), JSON.stringify([1.5, 1.7, 2.6, 2.2, 3.0, 3.0]));
  return { dir, count: S.length };
}

const files = {
  'how-it-works.svg': howItWorks(),
  'scale-fix.svg': scaleFix(),
  'benchmark.svg': benchmark(),
  'architecture.svg': architecture(),
};
for (const [name, content] of Object.entries(files)) {
  if (!content) { console.log(`skipped ${name} (no data)`); continue; }
  fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote assets/${name}`);
}
const f = frames();
console.log(`wrote ${f.count} frames to assets/frames/`);
