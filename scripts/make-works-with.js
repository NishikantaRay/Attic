#!/usr/bin/env node
'use strict';
/**
 * make-works-with.js — the "works with" card.
 *
 * The claim is compatibility, so the picture has to be one folder with several
 * things writing into it — not a logo wall. Everything points at a single
 * `.attic/`, because "one memory, several tools" is the whole idea and a row
 * of marks says only "we integrate".
 *
 * THIRD-PARTY NAMES ARE SET AS WORDMARKS, NEVER REDRAWN.
 * Chrome, Brave, Edge, Claude Code and Codex CLI are other people's
 * trademarks. Redrawing them is a legal risk and usually a poor likeness, and
 * embedding official files would drag their brand rules into this repo. A name
 * set in our own typeface needs no permission and stays on-brand. Attic's mark
 * is the only logo on the card.
 *
 * Palette, type and the mark are lifted from make-social.js so the set reads
 * as one family: warm paper rather than near-black, a single reserved green.
 *
 * Sizes match assets/social/: 2400x1254 (1.91:1, fits LinkedIn and X) and
 * 2160x2160 square, both 2x for retina.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'social');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  paper: '#FBF9F5',
  paperEdge: '#F0EBE1',
  ink: '#1A1815',
  inkSoft: '#6B6459',
  ghost: '#CFC8BB',
  keep: '#0B5D3B',
  keepSoft: '#D9E5DE',
  rule: '#E2DCD0',
};
const F = {
  display: "Charter, 'Iowan Old Style', Georgia, serif",
  label: "Futura, 'Avenir Next', Avenir, sans-serif",
  mono: "Menlo, 'SF Mono', monospace",
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Attic's mark: a roof over three stacked boxes. Same geometry as logo.svg. */
function mark(ox, oy, s, { accent = P.ink } = {}) {
  const X = (x) => (ox + x * s).toFixed(2);
  const Y = (y) => (oy + y * s).toFixed(2);
  const w = (n) => (n * s).toFixed(2);
  const bar = (yy, op) => `<rect x="${X(30)}" y="${Y(yy)}" width="${w(40)}" height="${w(9)}" rx="${w(2)}" fill="${P.keep}" opacity="${op}"/>`;
  return `
  <path d="M ${X(50)},${Y(10)} L ${X(88)},${Y(43)} L ${X(88)},${Y(52)} L ${X(50)},${Y(19)} L ${X(12)},${Y(52)} L ${X(12)},${Y(43)} Z" fill="${accent}"/>
  <path d="M ${X(20)},${Y(44)} L ${X(20)},${Y(88)} L ${X(26)},${Y(88)} L ${X(26)},${Y(44)} Z" fill="${accent}" opacity="0.35"/>
  <path d="M ${X(74)},${Y(44)} L ${X(74)},${Y(88)} L ${X(80)},${Y(88)} L ${X(80)},${Y(44)} Z" fill="${accent}" opacity="0.35"/>
  ${bar(56, 0.3)}${bar(69, 0.6)}${bar(82, 1)}`;
}

/**
 * One source that writes into the attic: a label, a name, and a line of what
 * it contributes. Deliberately typographic — see the trademark note above.
 */
function source(x, y, w, label, name, detail, align = 'start') {
  const tx = align === 'end' ? x + w : x;
  return `
  <text x="${tx}" y="${y}" text-anchor="${align}" font-family="${F.label}" font-size="17" letter-spacing="1.6" fill="${P.inkSoft}">${esc(label)}</text>
  <text x="${tx}" y="${y + 40}" text-anchor="${align}" font-family="${F.display}" font-size="34" font-weight="700" fill="${P.ink}">${esc(name)}</text>
  <text x="${tx}" y="${y + 70}" text-anchor="${align}" font-family="${F.display}" font-size="20" fill="${P.inkSoft}">${esc(detail)}</text>`;
}

/**
 * The folder everything writes into. Drawn as a real file listing rather than
 * a folder icon: the point of Attic is that it is plain files you can open.
 */
function folder(x, y, w, h) {
  const rows = [
    ['INDEX.md', 'one line per item'],
    ['items/redis-eviction.md', 'from your agent'],
    ['items/cache-no-ttl.md', 'clipped in the browser'],
    ['DECISIONS.md', 'what you chose, and why'],
  ];
  // The note sits UNDER its filename, not beside it: right-aligning it ran
  // straight into "items/redis-eviction.md", and widening the box would crowd
  // the sources on either side.
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" stroke="${P.rule}" stroke-width="2"/>
  <rect x="${x}" y="${y}" width="${w}" height="54" rx="14" fill="${P.keepSoft}"/>
  <rect x="${x}" y="${y + 36}" width="${w}" height="18" fill="${P.keepSoft}"/>
  <text x="${x + 26}" y="${y + 35}" font-family="${F.mono}" font-size="21" font-weight="700" fill="${P.keep}">.attic/</text>
  <text x="${x + w - 26}" y="${y + 35}" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="1.4" fill="${P.keep}">IN YOUR REPO</text>
  ${rows.map(([f, note], i) => {
    const ry = y + 92 + i * 48;
    return `<text x="${x + 26}" y="${ry}" font-family="${F.mono}" font-size="18" fill="${P.ink}">${esc(f)}</text>`
      + `<text x="${x + 26}" y="${ry + 20}" font-family="${F.display}" font-size="16" fill="${P.inkSoft}">${esc(note)}</text>`;
  }).join('\n  ')}`;
}

/** An arrow from a source into the folder. */
function arrow(x1, y1, x2, y2) {
  return `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${P.ghost}" stroke-width="2.5"
    stroke-linecap="round" marker-end="url(#tip)"/>`;
}

const defs = `
<defs>
  <marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
    <path d="M0,1 L9,5 L0,9 z" fill="${P.ghost}"/>
  </marker>
</defs>`;

// ---------------------------------------------------------------------------
// 1.91:1 — LinkedIn, X, Open Graph
// ---------------------------------------------------------------------------
function wide() {
  const W = 1200, H = 628;
  const fx = 405, fw = 390; // folder box

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
  aria-label="Attic works with Claude Code, Codex CLI, Chrome, Brave and Edge, all writing to one .attic folder in your repo">
${defs}
<rect width="${W}" height="${H}" fill="${P.paper}"/>
<rect x="0" y="0" width="${W}" height="10" fill="${P.keep}"/>

${mark(64, 44, 0.42)}
<text x="114" y="84" font-family="${F.display}" font-size="28" font-weight="700" fill="${P.ink}">Attic</text>
<text x="${W - 64}" y="84" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="1.4" fill="${P.inkSoft}">OPEN SOURCE · MIT · NO TELEMETRY</text>

<text x="64" y="168" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">Two agents and your browser.</text>
<text x="64" y="220" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.keep}">One memory.</text>

<!-- sources, left -->
${source(64, 292, 300, 'CODING AGENTS', 'Claude Code', 'stashes what it works out')}
${source(64, 412, 300, '', 'Codex CLI', 'reads the same folder')}

<!-- the folder everything writes into -->
${folder(fx, 268, fw, 286)}

<!-- sources, right -->
${source(fx + fw + 36, 292, 300, 'BROWSER EXTENSION', 'Chrome · Brave', 'clip a page, right-click')}
${source(fx + fw + 36, 412, 300, '', 'Edge · Vivaldi', 'same format, same checks')}

${arrow(372, 336, fx - 14, 360)}
${arrow(372, 452, fx - 14, 420)}
${arrow(fx + fw + 24, 336, fx + fw + 14, 360)}
${arrow(fx + fw + 24, 452, fx + fw + 14, 420)}

<line x1="64" y1="574" x2="${W - 64}" y2="574" stroke="${P.rule}"/>
<text x="64" y="604" font-family="${F.display}" font-size="19" fill="${P.inkSoft}">Plain markdown. It survives /compact, /clear and a new session.</text>
<text x="${W - 64}" y="604" text-anchor="end" font-family="${F.mono}" font-size="16" fill="${P.keep}">github.com/NishikantaRay/Attic</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Square — Instagram, LinkedIn carousels
// ---------------------------------------------------------------------------
function square() {
  const S = 1080;
  const row = (y, label, name, detail) => `
  <text x="90" y="${y}" font-family="${F.label}" font-size="17" letter-spacing="1.6" fill="${P.inkSoft}">${esc(label)}</text>
  <text x="90" y="${y + 40}" font-family="${F.display}" font-size="34" font-weight="700" fill="${P.ink}">${esc(name)}</text>
  <text x="${S - 90}" y="${y + 40}" text-anchor="end" font-family="${F.display}" font-size="19" fill="${P.inkSoft}">${esc(detail)}</text>
  <line x1="90" y1="${y + 62}" x2="${S - 90}" y2="${y + 62}" stroke="${P.rule}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img"
  aria-label="Attic works with Claude Code, Codex CLI and Chromium browsers, all writing to one .attic folder">
<rect width="${S}" height="${S}" fill="${P.paper}"/>
<rect x="0" y="0" width="${S}" height="12" fill="${P.keep}"/>

${mark(90, 84, 0.62)}
<text x="166" y="144" font-family="${F.display}" font-size="38" font-weight="700" fill="${P.ink}">Attic</text>

<text x="90" y="268" font-family="${F.display}" font-size="60" font-weight="700" fill="${P.ink}">Two agents and</text>
<text x="90" y="336" font-family="${F.display}" font-size="60" font-weight="700" fill="${P.ink}">your browser.</text>
<text x="90" y="404" font-family="${F.display}" font-size="60" font-weight="700" fill="${P.keep}">One memory.</text>

${row(500, 'CODING AGENTS', 'Claude Code', 'stashes what it works out')}
${row(600, '', 'Codex CLI', 'reads the same folder')}
${row(700, 'BROWSER', 'Chrome · Brave · Edge', 'clip a page, right-click')}

${folder(90, 788, S - 180, 0).split('\n').slice(0, 0).join('')}
<rect x="90" y="790" width="${S - 180}" height="128" rx="14" fill="#fff" stroke="${P.rule}" stroke-width="2"/>
<rect x="90" y="790" width="${S - 180}" height="50" rx="14" fill="${P.keepSoft}"/>
<rect x="90" y="824" width="${S - 180}" height="16" fill="${P.keepSoft}"/>
<text x="116" y="824" font-family="${F.mono}" font-size="21" font-weight="700" fill="${P.keep}">.attic/</text>
<text x="${S - 116}" y="824" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="1.4" fill="${P.keep}">IN YOUR REPO</text>
<text x="116" y="878" font-family="${F.mono}" font-size="19" fill="${P.ink}">INDEX.md · items/ · DECISIONS.md</text>
<text x="${S - 116}" y="878" text-anchor="end" font-family="${F.display}" font-size="17" fill="${P.inkSoft}">plain markdown</text>

<text x="90" y="992" font-family="${F.mono}" font-size="18" fill="${P.keep}">github.com/NishikantaRay/Attic</text>
<text x="${S - 90}" y="992" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="1.4" fill="${P.inkSoft}">MIT · NO TELEMETRY</text>
</svg>
`;
}

fs.writeFileSync(path.join(OUT, 'works-with.svg'), wide());
fs.writeFileSync(path.join(OUT, 'works-with-square.svg'), square());
console.log('wrote assets/social/works-with.svg');
console.log('wrote assets/social/works-with-square.svg');
