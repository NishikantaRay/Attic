'use strict';
// The library hides and shows whole panes with the `hidden` attribute. That
// attribute is only `display: none` in the UA stylesheet, so any author
// `display` rule silently beats it — which once left the setup card painted
// on top of a fully working app. These are cheap static checks for that whole
// class of bug.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.join(__dirname, '..', 'extension');
const css = fs.readFileSync(path.join(EXT, 'library.css'), 'utf8');
const html = fs.readFileSync(path.join(EXT, 'library.html'), 'utf8');
const js = fs.readFileSync(path.join(EXT, 'library.js'), 'utf8');

test('an [hidden] rule exists and is !important', () => {
  const m = css.match(/\[hidden\][^{]*\{[^}]*\}/);
  assert.ok(m, 'library.css must neutralise the author display rules');
  assert.match(m[0], /display:\s*none\s*!important/);
});

test('every element toggled via .hidden in JS is declared hidden-safe', () => {
  // Ids the script flips with el.hidden = ...
  const toggled = new Set([...js.matchAll(/\$\('([^']+)'\)\.hidden\s*=/g)].map((m) => m[1]));
  assert.ok(toggled.size >= 3, 'expected the script to toggle several panes');
  for (const id of toggled) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is toggled in JS but absent from library.html`);
  }
});

test('the [hidden] rule precedes the display rules it has to beat', () => {
  // Equal specificity means source order decides, and !important settles it,
  // but keeping it first also documents the intent.
  const hiddenAt = css.indexOf('[hidden]');
  const setupAt = css.indexOf('.setup {');
  assert.ok(hiddenAt >= 0 && setupAt >= 0);
  assert.ok(hiddenAt < setupAt, '[hidden] should be declared before the pane rules');
});

test('boot awaits open() rather than returning it into the catch', () => {
  // `return open()` inside try{} escapes the catch: the rejection lands as an
  // unhandled promise and the UI is left in whatever state it was in.
  const code = js.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /return\s+open\(\)/, 'open() must be awaited inside the try block');
});

// ---------- theme ----------
// The library must work in three states: system (no attribute), explicit
// light, and explicit dark. Getting this wrong is invisible until someone
// with the opposite OS setting opens it.

test('light is the base and every token is defined on bare :root', () => {
  const base = css.slice(css.indexOf(':root {'), css.indexOf('@media'));
  const used = new Set([...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !base.includes(t + ':'));
  assert.deepEqual(missing, [], 'a colour defined only inside a media/attr block breaks the other theme');
});

test('dark is applied both by preference and by explicit attribute', () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    'the preference block must yield to an explicit light choice');
  assert.match(css, /:root\[data-theme="dark"\]/,
    'an explicit dark choice must win over a light system preference');
});

test('the palette is Attic\'s own, not an invented one', () => {
  // These are the exact values in assets/logo.svg and logo-wide.svg.
  for (const hex of ['#0969da', '#58a6ff', '#1a7f37', '#3fb950', '#0d1117']) {
    assert.ok(css.includes(hex), `expected the brand colour ${hex} from assets/logo.svg`);
  }
  assert.ok(!/#7c3aed|#a78bfa/.test(css), 'the old purple is not an Attic colour');
});

test('the logo is inline SVG painted with theme tokens', () => {
  // A PNG could not recolour between themes, and would need two files.
  assert.match(html, /<svg class="mark"/, 'the mark should be inline SVG');
  assert.match(html, /fill="var\(--brand\)"/, 'the mark must take the theme brand colour');
  assert.match(html, /fill="var\(--stack-top\)"/);
});

// ---------------------------------------------------------------------------
// v2 structure. The library grew a sidebar, panels, an editor and a palette;
// these keep the static contracts between the three files honest.
// ---------------------------------------------------------------------------

test('every element the script toggles or fills exists in the HTML', () => {
  // Wider than the .hidden check above: getElementById on a missing id returns
  // null, and the first property access after it throws, which in a render
  // path leaves a half-drawn pane.
  const referenced = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  // Ids created at render time by read(), so they are absent from the static
  // HTML on purpose.
  const runtime = new Set(['a-edit', 'a-pin', 'a-archive', 'copy-handle']);
  const missing = [...referenced].filter((id) => !runtime.has(id) && !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'these ids are used by library.js but do not exist in library.html');
});

test('the ids created at render time are all wired in the same pass', () => {
  // The counterpart to the exclusion above: if read() stops emitting one of
  // these, wireReader() is the thing that breaks, so they must appear in both.
  for (const id of ['a-edit', 'a-pin', 'a-archive', 'copy-handle']) {
    assert.ok(js.includes(`id="${id}"`), `read() must emit #${id}`);
    assert.ok(js.includes(`$('${id}')`), `wireReader() must bind #${id}`);
  }
});

test('the sidebar views in the HTML all exist in the script', () => {
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(views.length >= 4, 'expected several sidebar views');
  for (const v of views) {
    assert.ok(js.includes(`'${v}'`), `view "${v}" is in the HTML but the script never handles it`);
  }
});

test('a grid track that has to shrink uses minmax(0, 1fr)', () => {
  // A grid track's default minimum is min-content, so a bare `1fr` refuses to
  // shrink below its widest child and the pane is CLIPPED rather than
  // scrolled. This bit both the shell and the reader.
  for (const rule of ['.body-cols', '.reader-body']) {
    const at = css.indexOf(rule + ' {');
    assert.ok(at >= 0, `${rule} should exist`);
    const block = css.slice(at, css.indexOf('}', at));
    const decl = (block.match(/grid-template-columns:([^;]*)/) || [])[1];
    if (decl) {
      // Blank out the legitimate form first; any `1fr` still standing is bare.
      const rest = decl.replace(/minmax\([^)]*\)/g, '');
      assert.ok(!/\b1fr\b/.test(rest),
        `${rule} uses a bare 1fr ("${decl.trim()}"); a shrinkable track needs minmax(0, 1fr)`);
    }
  }
});

test('the markdown renderer is imported rather than reimplemented inline', () => {
  // Item bodies reach the DOM through innerHTML. If escaping ever moves back
  // into library.js it will drift from the tested renderer.
  assert.match(js, /from '\.\/markdown\.js'/);
  assert.ok(!/function esc\s*\(/.test(js), 'esc() belongs to markdown.js, not a second copy here');
});

test('every innerHTML of item-derived text goes through esc() or the renderer', () => {
  // A cheap approximation, but it catches the obvious regression: a template
  // literal dropping a raw item field straight into innerHTML.
  const raw = [...js.matchAll(/innerHTML\s*=\s*([\s\S]{0,400}?);\n/g)].map((m) => m[1]);
  for (const block of raw) {
    // Interpolations that are not escaped, rendered, or a plain loop join.
    const bad = [...block.matchAll(/\$\{([^}]+)\}/g)]
      .map((m) => m[1].trim())
      .filter((x) => /\b(item|e|i|r|p)\.(slug|hook|body|kind|error|msg)\b/.test(x))
      .filter((x) => !/^esc\(|^md\(|^snippet\(|^render\(/.test(x));
    assert.deepEqual(bad, [], `unescaped item text in an innerHTML template: ${bad.join(', ')}`);
  }
});

test('the keyboard map documents keys the script actually handles', () => {
  const listed = [...js.matchAll(/\['([^']+)', '[^']*'\]/g)].map((m) => m[0]);
  assert.ok(listed.length >= 8, 'the ? overlay should document the shortcuts');
  for (const key of ['e', 'c', 'r', 'p']) {
    assert.ok(js.includes(`case '${key}':`), `the map offers "${key}" so the handler must implement it`);
  }
});

test('the pin shortcut does not depend on a button that may not be rendered', () => {
  // $('a-pin') only exists while the reader is on screen, so clicking it from
  // a panel view silently did nothing.
  const at = js.indexOf("case 'p':");
  const block = js.slice(at, at + 400);
  assert.ok(!/\$\('a-pin'\)\s*&&\s*\$\('a-pin'\)\.click\(\)/.test(block),
    'the p shortcut should call the API path, not click a conditional button');
});

// ---------------------------------------------------------------------------
// Motion. The risk here is not that an animation looks wrong — it is that the
// UI stops feeling fast, or becomes unusable for someone who cannot tolerate
// movement. Both are checkable statically.
// ---------------------------------------------------------------------------

test('prefers-reduced-motion is honoured, and the looping shimmer is stopped', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(at >= 0, 'a reduced-motion block is not optional in a reading tool');
  const block = css.slice(at);
  assert.match(block, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /animation-iteration-count:\s*1\s*!important/,
    'an infinite animation must be capped, not merely sped up');
  assert.match(block, /\.skel-line\s*\{[^}]*animation:\s*none/,
    'the shimmer loop has to be switched off outright or it becomes a flicker');
});

test('the duration scale is defined once and nothing is slow', () => {
  const base = css.slice(css.indexOf(':root {'), css.indexOf('@media'));
  for (const t of ['--t-fast', '--t-base', '--t-slow', '--ease', '--ease-out']) {
    assert.ok(base.includes(t + ':'), `${t} must be defined on bare :root`);
  }
  // Anything past ~300ms reads as lag on a pane that swaps on every j/k.
  const ms = [...css.matchAll(/--t-\w+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(ms.length >= 3);
  for (const v of ms) assert.ok(v <= 300, `${v}ms is too slow for a UI key-repeat can drive`);
});

test('animations stick to compositor-safe properties', () => {
  // Animating height/top/left on a list forces layout every frame. The one
  // deliberate exception is the overview bar, which animates width once.
  const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)];
  assert.ok(frames.length >= 4, 'expected several keyframes');
  for (const [, name, body] of frames) {
    if (name === 'bar-grow') continue; // one-off, handful of elements, first paint only
    const bad = (body.match(/\b(height|top|left|right|bottom|margin|padding)\s*:/g) || [])
      .filter((p) => !/background-position/.test(p));
    assert.deepEqual(bad, [], `@keyframes ${name} animates a layout property: ${bad.join(', ')}`);
  }
});

test('the list does not re-animate on every search keystroke', () => {
  // Re-staggering ten rows per character is the single easiest way to make a
  // fast filter feel slow, so render() defaults to no animation and only a
  // real reload opts in.
  assert.match(js, /function render\(\{\s*animate\s*=\s*false/,
    'render() must default to no animation');
  const at = js.indexOf("$('q').addEventListener('input'");
  const handler = js.slice(at, at + 500);
  assert.ok(!/render\(\s*\{[^}]*animate:\s*true/.test(handler),
    'the search handler must not request the stagger');
  assert.match(js, /render\(\{ animate: true \}\)/, 'a genuine reload should still stagger');
});

test('the stagger is capped so a large attic does not trickle in', () => {
  assert.match(js, /STAGGER_MAX\s*=\s*\d+/);
  const cap = Number(js.match(/STAGGER_MAX\s*=\s*(\d+)/)[1]);
  assert.ok(cap <= 20, 'a high cap means rows still arriving long after the rest');
  assert.match(js, /idx < STAGGER_MAX/, 'the per-row index must respect the cap');
});

test('restartAnim forces a reflow, or re-rendering a pane animates nothing', () => {
  // Removing and re-adding a class in the same frame is coalesced into no
  // change; reading offsetWidth between them is what makes it re-run.
  const at = js.indexOf('function restartAnim');
  assert.ok(at >= 0);
  const fn = js.slice(at, at + 400);
  assert.match(fn, /classList\.remove/);
  assert.match(fn, /offsetWidth/, 'the forced reflow is load-bearing, not a stray read');
  assert.match(fn, /classList\.add/);
  assert.ok(fn.indexOf('offsetWidth') > fn.indexOf('classList.remove'), 'reflow must come after the remove');
  assert.ok(fn.indexOf('classList.add') > fn.indexOf('offsetWidth'), 'the add must come after the reflow');
});

test('a loading skeleton exists for both panes', () => {
  // A blank pane during load reads as broken; this is what makes the app feel
  // fast on a cold start.
  assert.match(js, /function showSkeleton/);
  assert.match(css, /\.skel-line\s*\{/);
  const fn = js.slice(js.indexOf('function showSkeleton'), js.indexOf('async function load'));
  assert.ok(fn.includes("$('list')"), 'the list needs a skeleton');
  assert.ok(fn.includes("$('reader')"), 'so does the reading pane, or two-thirds of the window sits blank');
});

// ---------------------------------------------------------------------------
// Clipping the right tab. The library is itself a tab, which is the whole
// difficulty: "the active tab" is the library, not the page the user wants.
// ---------------------------------------------------------------------------

test('the clip flow does not ask for only the active tab', () => {
  // {active: true} returns just the focused tab, which while the library is
  // open IS the library. It was then filtered out as chrome-extension://,
  // leaving nothing, and the clip form opened completely blank.
  const at = js.indexOf('async function grabActive');
  assert.ok(at >= 0);
  // Strip comments first: the explanation of this very bug quotes the broken
  // form, and a test that reads prose rather than code fails on its own docs.
  const fn = js.slice(at, js.indexOf('\n}', at)).replace(/\/\/[^\n]*/g, '');
  const firstQuery = fn.slice(0, fn.indexOf(')', fn.indexOf('chrome.tabs.query')));
  assert.ok(!/active:\s*true/.test(firstQuery),
    'the primary query must cover the whole window, or the library filters itself out to nothing');
  assert.match(fn, /lastFocusedWindow/);
});

test('the clippable filter excludes every page an extension cannot read', () => {
  const at = js.indexOf('function clippable');
  assert.ok(at >= 0, 'the URL check should be one named predicate, not inline twice');
  const fn = js.slice(at, js.indexOf('\n}', at));
  for (const scheme of ['chrome', 'chrome-extension', 'about', 'devtools', 'view-source', 'file']) {
    assert.ok(fn.includes(scheme), `${scheme}: pages cannot be clipped and must be filtered out`);
  }
});

test('a page whose text cannot be read still reports what it did get', () => {
  // Restricted pages (PDF viewer, Web Store) yield a title and URL but no
  // text. Silently showing an empty body looks identical to a broken clip.
  const at = js.indexOf('async function startClip');
  const fn = js.slice(at, js.indexOf('\n}\n', at));
  assert.match(fn, /!p\.text/, 'the no-text case needs its own message');
  assert.match(fn, /could not be read/);
});
