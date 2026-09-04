#!/usr/bin/env node
'use strict';
/**
 * make-logo.js — the Attic mark. No dependencies.
 *
 * The idea: an attic is the roof space of a house where things are kept out
 * of the way but stay findable. The mark is a gable roof and two wall posts
 * enclosing three stacked bars — index lines — with the bottom bar
 * highlighted, because "the newest item always survives the trim" is the
 * behaviour that matters most.
 *
 * Emits:
 *   logo.svg        square mark, transparent, for avatars and favicons
 *   logo-wide.svg   mark + wordmark, for the README header
 *   logo-light.svg  same mark tuned for light backgrounds
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const T = {
  roof: '#58a6ff',
  bar: '#3fb950',
  barDim: '#2d6a3e',
  ink: '#e6edf3',
  inkDim: '#8b949e',
  inkLight: '#1f2328',
  inkLightDim: '#59636e',
  sans: '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif',
};

/**
 * The mark, drawn in a 100x100 box at (ox, oy) scaled by s.
 * Roof apex at the top, three bars beneath it, newest (bottom) highlighted.
 */
function mark(ox = 0, oy = 0, s = 1, opts = {}) {
  const roof = opts.roof || T.roof;
  const bar = opts.bar || T.bar;
  const barDim = opts.barDim || T.barDim;
  const X = (x) => (ox + x * s).toFixed(2);
  const Y = (y) => (oy + y * s).toFixed(2);
  const w = (n) => (n * s).toFixed(2);
  // Bars are equal width and sit inside the walls: a stack on a shelf, not a
  // pyramid. The bottom bar is the newest and is the one that always survives.
  const bar_ = (y, fill, op) =>
    `<rect x="${X(30)}" y="${Y(y)}" width="${w(40)}" height="${w(9)}" rx="${w(2.5)}" fill="${fill}"${op ? ` opacity="${op}"` : ''}/>`;
  return `
  <path d="M ${X(50)},${Y(10)} L ${X(88)},${Y(43)} L ${X(88)},${Y(52)} L ${X(50)},${Y(19)} L ${X(12)},${Y(52)} L ${X(12)},${Y(43)} Z" fill="${roof}"/>
  <path d="M ${X(20)},${Y(44)} L ${X(20)},${Y(88)} L ${X(26)},${Y(88)} L ${X(26)},${Y(44)} Z" fill="${roof}" opacity="0.55"/>
  <path d="M ${X(74)},${Y(44)} L ${X(74)},${Y(88)} L ${X(80)},${Y(88)} L ${X(80)},${Y(44)} Z" fill="${roof}" opacity="0.55"/>
  ${bar_(56, barDim, 0.5)}
  ${bar_(69, barDim, 0.8)}
  ${bar_(82, bar)}`;
}

function squareLogo(theme) {
  const roof = theme === 'light' ? '#0969da' : T.roof;
  const bar = theme === 'light' ? '#1a7f37' : T.bar;
  const barDim = theme === 'light' ? '#aecfb8' : T.barDim;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100" role="img" aria-label="Attic">
<title>Attic</title>
${mark(0, 0, 1, { roof, bar, barDim })}
</svg>
`;
}

function wideLogo(theme) {
  const light = theme === 'light';
  const roof = light ? '#0969da' : T.roof;
  const bar = light ? '#1a7f37' : T.bar;
  const barDim = light ? '#8fbf9f' : T.barDim;
  const ink = light ? T.inkLight : T.ink;
  const dim = light ? T.inkLightDim : T.inkDim;
  // A painted panel, not transparency: GitHub renders these on white in light
  // mode and near-black in dark mode, and a transparent wordmark disappears
  // in one of them.
  const panel = light ? '#ffffff' : '#0d1117';
  const edge = light ? '#d1d9e0' : '#30363d';
  const W = 620, H = 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attic — offload context">
<title>Attic — offload context</title>
<rect width="${W}" height="${H}" rx="14" fill="${panel}" stroke="${edge}"/>
${mark(28, 30, 1.0, { roof, bar, barDim })}
<text x="152" y="76" font-family="${T.sans}" font-size="48" font-weight="700" fill="${ink}" letter-spacing="-1">Attic</text>
<text x="153" y="105" font-family="${T.sans}" font-size="16.5" fill="${dim}">Offload context. Keep the chat lean.</text>
<text x="153" y="128" font-family="${T.sans}" font-size="13.5" fill="${dim}">Claude Code · Codex CLI</text>
</svg>
`;
}

const files = {
  'logo.svg': squareLogo('dark'),
  'logo-light.svg': squareLogo('light'),
  'logo-wide.svg': wideLogo('dark'),
  'logo-wide-light.svg': wideLogo('light'),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote assets/${name}`);
}
