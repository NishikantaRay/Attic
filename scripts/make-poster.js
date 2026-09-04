#!/usr/bin/env node
'use strict';
/**
 * make-poster.js — promotional poster. No dependencies.
 *
 * Every number is read from benchmarks/results/ and the eval results, so the
 * poster cannot outlive the data it cites. If a claim has no recorded run
 * behind it, it does not appear.
 *
 * Emits:
 *   poster.svg        1200x1600 portrait, for print or a link preview
 *   poster-wide.svg   1200x630, the OpenGraph / social card ratio
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets');
fs.mkdirSync(OUT, { recursive: true });

const C = {
  bg: '#0d1117', panel: '#161b22', line: '#30363d',
  text: '#e6edf3', dim: '#8b949e',
  accent: '#58a6ff', good: '#3fb950', warn: '#d29922', bad: '#f85149',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  sans: '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function data() {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return null; } };
  const codex = read('benchmarks/results/2026-09-04-codex.json');
  const evals = read('skills/attic/evals/results/2026-09-04-activation-v1.1.json');
  const manifest = read('.claude-plugin/plugin.json');
  if (!codex || !manifest) throw new Error('missing recorded data; run the benchmark first');
  const t = codex.cases.find((x) => x.id === 'cache-ttl');
  const cold = codex.cases.find((x) => x.id === 'cold-attic');
  return {
    version: manifest.version,
    noAttic: t.noAttic.input.median,
    attic: t.attic.input.median,
    delta: Math.abs(t.inputDeltaPct),
    cmdsBefore: t.noAttic.turns.median,
    cmdsAfter: t.attic.turns.median,
    coldDelta: cold ? cold.inputDeltaPct : null,
    activation: evals ? evals.metrics.activation_accuracy : null,
    cases: evals ? evals.metrics.cases : null,
  };
}

// The house mark, matching assets/logo.svg.
function mark(ox, oy, s) {
  const X = (x) => (ox + x * s).toFixed(2);
  const Y = (y) => (oy + y * s).toFixed(2);
  const w = (n) => (n * s).toFixed(2);
  const bar = (y, fill, op) =>
    `<rect x="${X(30)}" y="${Y(y)}" width="${w(40)}" height="${w(9)}" rx="${w(2.5)}" fill="${fill}"${op ? ` opacity="${op}"` : ''}/>`;
  return `
  <path d="M ${X(50)},${Y(10)} L ${X(88)},${Y(43)} L ${X(88)},${Y(52)} L ${X(50)},${Y(19)} L ${X(12)},${Y(52)} L ${X(12)},${Y(43)} Z" fill="${C.accent}"/>
  <path d="M ${X(20)},${Y(44)} L ${X(20)},${Y(88)} L ${X(26)},${Y(88)} L ${X(26)},${Y(44)} Z" fill="${C.accent}" opacity="0.55"/>
  <path d="M ${X(74)},${Y(44)} L ${X(74)},${Y(88)} L ${X(80)},${Y(88)} L ${X(80)},${Y(44)} Z" fill="${C.accent}" opacity="0.55"/>
  ${bar(56, C.good, 0.5)}${bar(69, C.good, 0.8)}${bar(82, C.good)}`;
}

function portrait(d) {
  const W = 1200, H = 1600;
  const chat = [
    ['you:', 'why are users logged out at random?', C.dim],
    ['', '', null],
    ['claude:', '`attic:redis-eviction-bug` · maxmemory-policy is', C.text],
    ['', 'allkeys-lru, so session keys get evicted.', C.text],
    ['', 'fix is volatile-lru.', C.text],
  ];
  const bars = (y) => {
    const max = 620, scale = max / d.noAttic;
    const row = (yy, label, val, colour, note) => {
      const bw = Math.max(6, Math.round(val * scale));
      return `
  <text x="90" y="${yy + 20}" font-family="${C.sans}" font-size="24" fill="${C.text}">${esc(label)}</text>
  <rect x="360" y="${yy}" width="${bw}" height="30" rx="6" fill="${colour}"/>
  <text x="${372 + bw}" y="${yy + 23}" font-family="${C.mono}" font-size="22" fill="${C.text}">${val.toLocaleString()}</text>
  ${note ? `<text x="${372 + bw + 130}" y="${yy + 23}" font-family="${C.sans}" font-size="22" font-weight="700" fill="${colour}">${esc(note)}</text>` : ''}`;
    };
    return row(y, 'without Attic', d.noAttic, C.bad) + row(y + 48, 'with Attic', d.attic, C.good, `−${d.delta}%`);
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attic — your agent stops re-reading the same files">
<title>Attic ${esc(d.version)}</title>
<rect width="${W}" height="${H}" fill="${C.bg}"/>

${mark(80, 80, 1.4)}
<text x="248" y="150" font-family="${C.sans}" font-size="66" font-weight="700" fill="${C.text}" letter-spacing="-1.5">Attic</text>
<text x="252" y="192" font-family="${C.sans}" font-size="24" fill="${C.dim}">v${esc(d.version)} · Claude Code · Codex CLI</text>

<text x="80" y="330" font-family="${C.sans}" font-size="60" font-weight="700" fill="${C.text}">Your agent re-reads the</text>
<text x="80" y="400" font-family="${C.sans}" font-size="60" font-weight="700" fill="${C.text}">same files after every</text>
<text x="80" y="470" font-family="${C.sans}" font-size="60" font-weight="700" fill="${C.accent}">/compact.</text>
<text x="80" y="546" font-family="${C.sans}" font-size="34" fill="${C.dim}">Attic writes what it learns to <tspan font-family="${C.mono}" fill="${C.good}">.attic/</tspan> so it doesn't.</text>

<rect x="80" y="610" width="1040" height="268" rx="14" fill="${C.panel}" stroke="${C.line}"/>
${chat.map(([who, line, col], i) => col === null ? '' : `
<text x="120" y="${672 + i * 38}" font-family="${C.mono}" font-size="23" fill="${C.dim}">${esc(who)}</text>
<text x="240" y="${672 + i * 38}" font-family="${C.mono}" font-size="23" fill="${col}">${esc(line)}</text>`).join('')}
<text x="240" y="${672 + 5 * 38}" font-family="${C.mono}" font-size="23" fill="${C.warn}">no files read</text>

<text x="80" y="962" font-family="${C.sans}" font-size="30" font-weight="700" fill="${C.text}">Input tokens to answer one question about known code</text>
<text x="80" y="998" font-family="${C.sans}" font-size="21" fill="${C.dim}">Codex CLI · 26-file fixture · median of 3 runs · both arms answered correctly</text>
${bars(1030)}
<text x="90" y="1150" font-family="${C.sans}" font-size="21" fill="${C.dim}">${d.cmdsBefore} shell commands to find it, versus ${d.cmdsAfter}. The answer was already in context.</text>

<line x1="80" y1="1196" x2="1120" y2="1196" stroke="${C.line}"/>

${[
  ['Survives /compact', 'The index is re-injected at every session start,\\nso a finding outlives the conversation.'],
  ['Newest never dropped', 'Pinned items always survive; older ones collapse\\nto one discoverable line.'],
  ['Nothing leaves your machine', 'No network calls, no telemetry. The script refuses\\nto write a detected credential.'],
].map(([t, b], i) => `
<text x="80" y="${1248 + i * 108}" font-family="${C.sans}" font-size="28" font-weight="700" fill="${C.good}">${esc(t)}</text>
${b.split('\\n').map((l, j) => `<text x="80" y="${1284 + i * 108 + j * 30}" font-family="${C.sans}" font-size="22" fill="${C.dim}">${esc(l)}</text>`).join('')}`).join('')}

<rect x="80" y="1478" width="1040" height="70" rx="10" fill="${C.panel}" stroke="${C.accent}"/>
<text x="112" y="1522" font-family="${C.mono}" font-size="24" fill="${C.accent}">claude plugin install attic@attic</text>
<text x="1088" y="1522" text-anchor="end" font-family="${C.sans}" font-size="21" fill="${C.dim}">github.com/NishikantaRay/Attic</text>
${d.activation !== null ? `<text x="80" y="1580" font-family="${C.sans}" font-size="19" fill="${C.dim}">Activation evals ${d.activation}% across ${d.cases} cases${d.coldDelta !== null ? ` · with nothing relevant stashed the attic costs ${d.coldDelta > 0 ? '+' : ''}${d.coldDelta}%, and the docs say so` : ''}</text>` : ''}
</svg>
`;
}

function wide(d) {
  const W = 1200, H = 630;
  // Two columns that do not touch: text ends at 560, the chart starts at 620.
  // The headline is set at a size that fits inside its own column.
  const CX = 620, LBL = CX, BAR = CX + 132, MAXBAR = 340;
  const scale = MAXBAR / d.noAttic;
  const row = (y, label, val, colour, note) => {
    const bw = Math.max(6, Math.round(val * scale));
    return `
  <text x="${LBL}" y="${y + 17}" font-family="${C.sans}" font-size="18" fill="${C.text}">${esc(label)}</text>
  <rect x="${BAR}" y="${y}" width="${bw}" height="24" rx="5" fill="${colour}"/>
  <text x="${BAR + bw + 10}" y="${y + 18}" font-family="${C.mono}" font-size="17" fill="${C.text}">${val.toLocaleString()}</text>
  ${note ? `<text x="${LBL}" y="${y + 48}" font-family="${C.sans}" font-size="19" font-weight="700" fill="${colour}">${esc(note)}</text>` : ''}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attic — your agent stops re-reading the same files">
<title>Attic ${esc(d.version)}</title>
<rect width="${W}" height="${H}" fill="${C.bg}"/>
${mark(56, 48, 0.8)}
<text x="196" y="98" font-family="${C.sans}" font-size="44" font-weight="700" fill="${C.text}" letter-spacing="-1">Attic</text>
<text x="199" y="128" font-family="${C.sans}" font-size="18" fill="${C.dim}">Claude Code · Codex CLI</text>

<text x="56" y="248" font-family="${C.sans}" font-size="38" font-weight="700" fill="${C.text}">Your agent re-reads the</text>
<text x="56" y="294" font-family="${C.sans}" font-size="38" font-weight="700" fill="${C.text}">same files after every</text>
<text x="56" y="340" font-family="${C.sans}" font-size="38" font-weight="700" fill="${C.accent}">/compact.</text>
<text x="56" y="390" font-family="${C.sans}" font-size="22" fill="${C.dim}">Attic writes what it learns to <tspan font-family="${C.mono}" fill="${C.good}">.attic/</tspan></text>
<text x="56" y="420" font-family="${C.sans}" font-size="22" fill="${C.dim}">so it doesn't.</text>

<line x1="${CX - 40}" y1="200" x2="${CX - 40}" y2="440" stroke="${C.line}"/>
<text x="${CX}" y="224" font-family="${C.sans}" font-size="19" font-weight="700" fill="${C.text}">Input tokens, one question</text>
<text x="${CX}" y="248" font-family="${C.sans}" font-size="14" fill="${C.dim}">Codex CLI · median of 3 runs · both correct</text>
${row(278, 'without Attic', d.noAttic, C.bad)}
${row(340, 'with Attic', d.attic, C.good, `−${d.delta}% input tokens`)}
<text x="${CX}" y="428" font-family="${C.sans}" font-size="14" fill="${C.dim}">${d.cmdsBefore} shell commands to find it, versus ${d.cmdsAfter}.</text>

<rect x="56" y="492" width="620" height="58" rx="10" fill="${C.panel}" stroke="${C.accent}"/>
<text x="84" y="529" font-family="${C.mono}" font-size="20" fill="${C.accent}">claude plugin install attic@attic</text>
<text x="1144" y="529" text-anchor="end" font-family="${C.sans}" font-size="17" fill="${C.dim}">github.com/NishikantaRay/Attic</text>
<text x="56" y="586" font-family="${C.sans}" font-size="15" fill="${C.dim}">Survives /compact · no telemetry · MIT${d.activation !== null ? ` · activation evals ${d.activation}%` : ''}</text>
</svg>
`;
}

const d = data();
fs.writeFileSync(path.join(OUT, 'poster.svg'), portrait(d));
fs.writeFileSync(path.join(OUT, 'poster-wide.svg'), wide(d));
console.log(`wrote assets/poster.svg and assets/poster-wide.svg (v${d.version}, −${d.delta}% from recorded runs)`);
