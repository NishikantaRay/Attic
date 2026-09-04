#!/usr/bin/env node
'use strict';
/**
 * make-social.js — the share card.
 *
 * Design idea: the card *is* the argument. Both halves show the same finding:
 * on the left it dissolves mid-sentence into a half-remembered question, on
 * the right it sits filed and solid with its handle. Same words, two fates.
 * One image carries it, so the copy can stay short.
 *
 * Palette is warm paper rather than the usual near-black or clinical white:
 * an attic holds old paper. The single accent is a deep green reserved for
 * what is kept; nothing else in the card competes with it.
 *
 * Type: Charter for the headline (a real book face with character), Futura
 * for labels, Menlo for file names. Rasterised by rsvg-convert at native
 * size, so the PNG is exactly what the SVG says.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  paper: '#FBF9F5',   // warm ground, not white
  paperEdge: '#F0EBE1',
  ink: '#1A1815',     // warm near-black
  inkSoft: '#6B6459',
  ghost: '#CFC8BB',   // the forgetting side
  keep: '#0B5D3B',    // the one saturated colour, reserved for what is kept
  keepSoft: '#D9E5DE',
  rule: '#E2DCD0',
};
const F = {
  display: "Charter, 'Iowan Old Style', Georgia, serif",
  label: "Futura, 'Avenir Next', Avenir, sans-serif",
  mono: "Menlo, 'SF Mono', monospace",
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The two halves. Left: lines of a finding losing themselves. Right: the
 * same finding as one filed card with a handle.
 */
function scene(x, y, w, h) {
  const midX = x + w / 2;

  // Left: the same finding, but dissolving. Real words, fading out mid-thought,
  // so it reads as knowledge being lost rather than a loading skeleton.
  const lost = [
    ['maxmemory-policy is allkeys-lru,', 0.85],
    ['so session keys get evicted…', 0.5],
    ['…something about volatile-', 0.26],
    ['…lru?', 0.12],
  ];
  const lostLines = lost.map(([t, op], i) =>
    `<text x="${x + 6}" y="${y + 56 + i * 34}" font-family="${F.display}" font-size="19" fill="${P.ink}" opacity="${op}">${esc(t)}</text>`
  ).join('\n  ');

  const cx = midX + 62, cw = w / 2 - 62, ch = 152;
  return `
  <text x="${x + 6}" y="${y + 8}" font-family="${F.label}" font-size="15" letter-spacing="1.6" fill="${P.inkSoft}">WITHOUT ATTIC</text>
  ${lostLines}
  <text x="${x + 6}" y="${y + 196}" font-family="${F.mono}" font-size="16" fill="${P.inkSoft}">reads the same files again</text>

  <path d="M ${midX + 14} ${y - 6} L ${midX + 14} ${y + 208}" stroke="${P.rule}" stroke-width="1.5" stroke-dasharray="3 7"/>

  <text x="${cx}" y="${y + 8}" font-family="${F.label}" font-size="15" letter-spacing="1.6" fill="${P.keep}">WITH ATTIC</text>
  <rect x="${cx}" y="${y + 26}" width="${cw}" height="${ch}" rx="3" fill="#FFFFFF" stroke="${P.rule}"/>
  <rect x="${cx}" y="${y + 26}" width="7" height="${ch}" rx="3" fill="${P.keep}"/>
  <text x="${cx + 26}" y="${y + 60}" font-family="${F.mono}" font-size="17" fill="${P.keep}">attic:redis-eviction</text>
  <text x="${cx + 26}" y="${y + 92}" font-family="${F.display}" font-size="19" fill="${P.ink}">maxmemory-policy is allkeys-lru,</text>
  <text x="${cx + 26}" y="${y + 118}" font-family="${F.display}" font-size="19" fill="${P.ink}">so session keys get evicted.</text>
  <text x="${cx + 26}" y="${y + 152}" font-family="${F.display}" font-size="19" fill="${P.inkSoft}">Fix: volatile-lru.</text>
  <text x="${cx}" y="${y + 196}" font-family="${F.mono}" font-size="16" fill="${P.keep}">still there tomorrow</text>`;
}

function mark(ox, oy, s) {
  const X = (x) => (ox + x * s).toFixed(2);
  const Y = (y) => (oy + y * s).toFixed(2);
  const w = (n) => (n * s).toFixed(2);
  const bar = (yy, op) => `<rect x="${X(30)}" y="${Y(yy)}" width="${w(40)}" height="${w(9)}" rx="${w(2)}" fill="${P.keep}" opacity="${op}"/>`;
  return `
  <path d="M ${X(50)},${Y(10)} L ${X(88)},${Y(43)} L ${X(88)},${Y(52)} L ${X(50)},${Y(19)} L ${X(12)},${Y(52)} L ${X(12)},${Y(43)} Z" fill="${P.ink}"/>
  <path d="M ${X(20)},${Y(44)} L ${X(20)},${Y(88)} L ${X(26)},${Y(88)} L ${X(26)},${Y(44)} Z" fill="${P.ink}" opacity="0.35"/>
  <path d="M ${X(74)},${Y(44)} L ${X(74)},${Y(88)} L ${X(80)},${Y(88)} L ${X(80)},${Y(44)} Z" fill="${P.ink}" opacity="0.35"/>
  ${bar(56, 0.3)}${bar(69, 0.6)}${bar(82, 1)}`;
}

function card() {
  const W = 1200, H = 627;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attic: your agent forgets what it figured out; Attic writes it down">
<title>Attic</title>
<rect width="${W}" height="${H}" fill="${P.paper}"/>
<rect x="0" y="0" width="${W}" height="10" fill="${P.keep}"/>

${mark(72, 56, 0.5)}
<text x="130" y="98" font-family="${F.display}" font-size="30" font-weight="700" fill="${P.ink}">Attic</text>
<text x="1128" y="98" text-anchor="end" font-family="${F.label}" font-size="16" letter-spacing="1.2" fill="${P.inkSoft}">CLAUDE CODE · CODEX CLI</text>

<text x="72" y="196" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.ink}">Your agent figured it out once.</text>
<text x="72" y="252" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.keep}">Now it remembers.</text>

${scene(72, 330, 1056, 210)}

<line x1="72" y1="566" x2="1128" y2="566" stroke="${P.rule}"/>
<text x="72" y="598" font-family="${F.label}" font-size="16" letter-spacing="0.8" fill="${P.inkSoft}">OPEN SOURCE · MIT · NO TELEMETRY</text>
<text x="1128" y="598" text-anchor="end" font-family="${F.mono}" font-size="16" fill="${P.keep}">github.com/NishikantaRay/Attic</text>
</svg>
`;
}

fs.writeFileSync(path.join(OUT, 'social-card.svg'), card());
console.log('wrote assets/social-card.svg');
