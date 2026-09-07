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
