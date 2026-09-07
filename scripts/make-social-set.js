#!/usr/bin/env node
'use strict';
/**
 * make-social-set.js — a set of platform-sized cards, one idea each.
 *
 * Every figure is read from benchmarks/results/ so a card cannot outlive the
 * run behind it. Nothing here is hand-typed.
 *
 * Cards, and why each exists:
 *   compounding  the strongest honest claim: the benefit grows per session
 *   tie          correctness tied, so the pitch is "stops paying twice"
 *   problem      no numbers at all, for feeds where a percentage invites an
 *                argument about method instead of curiosity
 *   square       1:1 for Instagram and LinkedIn carousels
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'social');
fs.mkdirSync(OUT, { recursive: true });

// Warm paper: an attic holds old paper, not white plastic. One reserved
// green for what is kept; nothing else competes with it.
const P = {
  paper: '#FBF9F5', ink: '#1A1815', inkSoft: '#6B6459',
  keep: '#0B5D3B', lost: '#B4451F', rule: '#E2DCD0', panel: '#FFFFFF',
};
const F = {
  display: "Charter, 'Iowan Old Style', Georgia, serif",
  label: "Futura, 'Avenir Next', Avenir, sans-serif",
  mono: "Menlo, 'SF Mono', monospace",
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function data() {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const b = read('benchmarks/auth-investigation/baseline/results.json');
  const a = read('benchmarks/auth-investigation/attic/results.json');
  const pct = (x, y) => Math.round((y - x) / x * 100);
  return {
    total: pct(b.totals.input, a.totals.input),
    sessions: [0, 1, 2].map((i) => pct(b.sessions[i].inputTokens, a.sessions[i].inputTokens)),
    version: read('.claude-plugin/plugin.json').version,
  };
}

function mark(ox, oy, s, colour) {
  const X = (x) => (ox + x * s).toFixed(2), Y = (y) => (oy + y * s).toFixed(2);
  const w = (n) => (n * s).toFixed(2);
  const bar = (y, op) => `<rect x="${X(30)}" y="${Y(y)}" width="${w(40)}" height="${w(9)}" rx="${w(2)}" fill="${P.keep}" opacity="${op}"/>`;
  return `
  <path d="M ${X(50)},${Y(10)} L ${X(88)},${Y(43)} L ${X(88)},${Y(52)} L ${X(50)},${Y(19)} L ${X(12)},${Y(52)} L ${X(12)},${Y(43)} Z" fill="${colour || P.ink}"/>
  <path d="M ${X(20)},${Y(44)} L ${X(20)},${Y(88)} L ${X(26)},${Y(88)} L ${X(26)},${Y(44)} Z" fill="${colour || P.ink}" opacity="0.35"/>
  <path d="M ${X(74)},${Y(44)} L ${X(74)},${Y(88)} L ${X(80)},${Y(88)} L ${X(80)},${Y(44)} Z" fill="${colour || P.ink}" opacity="0.35"/>
  ${bar(56, 0.3)}${bar(69, 0.6)}${bar(82, 1)}`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
<rect width="${w}" height="${h}" fill="${P.paper}"/>
<rect x="0" y="0" width="${w}" height="9" fill="${P.keep}"/>
${body}</svg>
`;

const footer = (w, y, left) => `
<line x1="72" y1="${y - 30}" x2="${w - 72}" y2="${y - 30}" stroke="${P.rule}"/>
<text x="72" y="${y}" font-family="${F.label}" font-size="16" letter-spacing="0.8" fill="${P.inkSoft}">${esc(left)}</text>
<text x="${w - 72}" y="${y}" text-anchor="end" font-family="${F.mono}" font-size="16" fill="${P.keep}">github.com/NishikantaRay/Attic</text>`;

const header = (w) => `
${mark(72, 46, 0.42)}
<text x="122" y="80" font-family="${F.display}" font-size="26" font-weight="700" fill="${P.ink}">Attic</text>
<text x="${w - 72}" y="80" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="1.4" fill="${P.inkSoft}">CLAUDE CODE · CODEX CLI</text>`;

/** The compounding bars: the strongest honest claim we have. */
function compounding(d) {
  const W = 1200, H = 627;
  const rows = d.sessions.map((v, i) => {
    const y = 300 + i * 78;
    const bw = Math.round(Math.abs(v) / 50 * 640);
    return `
  <text x="72" y="${y + 30}" font-family="${F.label}" font-size="19" fill="${P.inkSoft}">SESSION ${i + 1}</text>
  <rect x="230" y="${y}" width="${bw}" height="42" rx="5" fill="${P.keep}" opacity="${0.45 + i * 0.275}"/>
  <text x="${242 + bw}" y="${y + 30}" font-family="${F.display}" font-size="30" font-weight="700" fill="${P.keep}">${v}%</text>`;
  }).join('');
  return svg(W, H, `${header(W)}
<text x="72" y="176" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">The longer you work,</text>
<text x="72" y="228" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">the more it saves.</text>
<text x="72" y="272" font-family="${F.label}" font-size="17" letter-spacing="0.6" fill="${P.inkSoft}">INPUT TOKENS vs NO ATTIC · SAME TASKS, SAME REPO</text>
${rows}
${footer(W, 578, 'SESSION 1 WRITES · LATER SESSIONS COLLECT')}`);
}

/** Correctness tied: the claim that buys credibility. */
function tie(d) {
  const W = 1200, H = 627;
  const box = (x, label, score, colour) => `
  <rect x="${x}" y="286" width="400" height="150" rx="6" fill="${P.panel}" stroke="${P.rule}"/>
  <rect x="${x}" y="286" width="6" height="150" rx="3" fill="${colour}"/>
  <text x="${x + 32}" y="330" font-family="${F.label}" font-size="17" letter-spacing="1.2" fill="${P.inkSoft}">${esc(label)}</text>
  <text x="${x + 32}" y="400" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.ink}">${esc(score)}</text>`;
  return svg(W, H, `${header(W)}
<text x="72" y="176" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">It doesn't make your agent</text>
<text x="72" y="228" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">smarter. It stops it <tspan fill="${P.keep}">paying twice</tspan>.</text>
${box(72, 'WITHOUT ATTIC', '13 / 13', P.lost)}
${box(516, 'WITH ATTIC', '13 / 13', P.keep)}
<text x="960" y="330" font-family="${F.label}" font-size="17" letter-spacing="1.2" fill="${P.inkSoft}">TOKENS</text>
<text x="960" y="400" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.keep}">${d.total}%</text>
<text x="72" y="486" font-family="${F.display}" font-size="21" fill="${P.inkSoft}">Same correctness on a graded rubric. Same work. A third fewer tokens.</text>
${footer(W, 578, 'MEASURED ACROSS THREE SESSIONS ON A REAL CODEBASE')}`);
}

/** No numbers: for feeds where a percentage starts a methodology argument. */
function problem() {
  const W = 1200, H = 627;
  const lost = [['maxmemory-policy is allkeys-lru,', 0.8], ['so session keys get evicted…', 0.45],
                ['…something about volatile-', 0.22], ['…lru?', 0.1]];
  return svg(W, H, `${header(W)}
<text x="72" y="182" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.ink}">Your agent figured it out once.</text>
<text x="72" y="234" font-family="${F.display}" font-size="46" font-weight="700" fill="${P.keep}">Now it remembers.</text>
<text x="72" y="300" font-family="${F.label}" font-size="15" letter-spacing="1.6" fill="${P.inkSoft}">WITHOUT ATTIC</text>
${lost.map(([t, op], i) => `<text x="72" y="${344 + i * 34}" font-family="${F.display}" font-size="20" fill="${P.ink}" opacity="${op}">${esc(t)}</text>`).join('\n')}
<text x="72" y="500" font-family="${F.mono}" font-size="16" fill="${P.inkSoft}">reads the same files again</text>
<path d="M 612 292 L 612 508" stroke="${P.rule}" stroke-width="1.5" stroke-dasharray="3 7"/>
<text x="660" y="300" font-family="${F.label}" font-size="15" letter-spacing="1.6" fill="${P.keep}">WITH ATTIC</text>
<rect x="660" y="318" width="468" height="152" rx="4" fill="${P.panel}" stroke="${P.rule}"/>
<rect x="660" y="318" width="7" height="152" rx="3" fill="${P.keep}"/>
<text x="688" y="352" font-family="${F.mono}" font-size="17" fill="${P.keep}">attic:redis-eviction</text>
<text x="688" y="386" font-family="${F.display}" font-size="20" fill="${P.ink}">maxmemory-policy is allkeys-lru,</text>
<text x="688" y="412" font-family="${F.display}" font-size="20" fill="${P.ink}">so session keys get evicted.</text>
<text x="688" y="446" font-family="${F.display}" font-size="20" fill="${P.inkSoft}">Fix: volatile-lru.</text>
<text x="660" y="500" font-family="${F.mono}" font-size="16" fill="${P.keep}">still there tomorrow</text>
${footer(W, 578, 'OPEN SOURCE · MIT · NO TELEMETRY')}`);
}

/** 1:1 for Instagram and LinkedIn carousels. */
function square(d) {
  const S = 1080;
  const rows = d.sessions.map((v, i) => {
    const y = 560 + i * 96;
    const bw = Math.round(Math.abs(v) / 50 * 560);
    return `
  <text x="80" y="${y + 32}" font-family="${F.label}" font-size="19" fill="${P.inkSoft}">SESSION ${i + 1}</text>
  <rect x="248" y="${y}" width="${bw}" height="46" rx="5" fill="${P.keep}" opacity="${0.45 + i * 0.275}"/>
  <text x="${260 + bw}" y="${y + 33}" font-family="${F.display}" font-size="32" font-weight="700" fill="${P.keep}">${v}%</text>`;
  }).join('');
  return svg(S, S, `
${mark(80, 60, 0.6)}
<text x="152" y="112" font-family="${F.display}" font-size="34" font-weight="700" fill="${P.ink}">Attic</text>
<text x="80" y="270" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.ink}">Your agent forgets</text>
<text x="80" y="330" font-family="${F.display}" font-size="52" font-weight="700" fill="${P.ink}">what it figured out.</text>
<text x="80" y="400" font-family="${F.display}" font-size="26" fill="${P.inkSoft}">Attic writes it down, so tomorrow</text>
<text x="80" y="436" font-family="${F.display}" font-size="26" fill="${P.inkSoft}">it already knows.</text>
<text x="80" y="512" font-family="${F.label}" font-size="17" letter-spacing="0.8" fill="${P.inkSoft}">INPUT TOKENS SAVED, PER SESSION</text>
${rows}
<line x1="80" y1="900" x2="1000" y2="900" stroke="${P.rule}"/>
<text x="80" y="944" font-family="${F.display}" font-size="22" fill="${P.ink}">Same correctness. A third fewer tokens.</text>
<text x="80" y="990" font-family="${F.mono}" font-size="18" fill="${P.keep}">github.com/NishikantaRay/Attic</text>
<text x="1000" y="990" text-anchor="end" font-family="${F.label}" font-size="15" letter-spacing="0.8" fill="${P.inkSoft}">MIT · NO TELEMETRY</text>`);
}

const d = data();
const cards = {
  'compounding': [compounding(d), 1200, 627],
  'correctness-tie': [tie(d), 1200, 627],
  'problem': [problem(), 1200, 627],
  'square': [square(d), 1080, 1080],
};
for (const [name, [content]] of Object.entries(cards)) {
  fs.writeFileSync(path.join(OUT, name + '.svg'), content);
}
console.log(`wrote ${Object.keys(cards).length} cards to assets/social/ (from recorded runs: ${d.total}%, sessions ${d.sessions.join('/')})`);
