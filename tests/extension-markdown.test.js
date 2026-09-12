'use strict';
/**
 * The reader renders item bodies as markdown via innerHTML, and those bodies
 * contain clipped web pages. So the load-bearing property here is not "the
 * heading became an h1" — it is that NOTHING in a body can become live markup.
 *
 * The rule the renderer follows is escape first, then add structure. These
 * tests exist to keep that true as constructs are added.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MD = pathToFileURL(path.join(__dirname, '..', 'extension', 'markdown.js')).href;
let md;
const load = async () => (md || (md = await import(MD)));

// ---------- escaping ----------

test('raw HTML in a body is escaped, never emitted', async () => {
  const { render } = await load();
  const out = render('<img src=x onerror="alert(1)">\n\nplain <b>text</b>');
  assert.ok(!/<img/.test(out), 'an img tag from the source must not survive');
  assert.ok(!/onerror=/.test(out.replace(/&quot;/g, '')) || !/<[^>]*onerror/.test(out));
  assert.ok(!/<b>/.test(out), 'source markup must not become real markup');
  assert.ok(out.includes('&lt;img'));
});

test('a script tag inside a fenced code block stays inert', async () => {
  const { render } = await load();
  const out = render('```js\nconst x = "<script>alert(1)</script>";\n```');
  assert.ok(!/<script/.test(out));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('only http(s) links survive; javascript: is dropped', async () => {
  const { render } = await load();
  const ok = render('[safe](https://example.com)');
  assert.match(ok, /href="https:\/\/example\.com"/);
  assert.match(ok, /rel="noopener noreferrer"/);

  for (const scheme of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd']) {
    const out = render(`[click](${scheme})`);
    assert.ok(!/<a href/.test(out), `${scheme} must not produce a link`);
    assert.ok(out.includes('click'), 'the label survives as plain text');
    assert.ok(!/\)/.test(out.replace(/[^)]*$/, '')) || !out.trim().endsWith(')'),
      'the whole construct is consumed, leaving no stray bracket');
  }
});

test('a table cell cannot smuggle markup', async () => {
  const { render } = await load();
  const out = render('| a | b |\n|---|---|\n| <script>x</script> | ok |');
  assert.ok(!/<script/.test(out));
  assert.match(out, /<table>/);
});

// ---------- structure ----------

test('headings, lists, quotes, tables and rules render', async () => {
  const { render } = await load();
  const out = render([
    '# One', '## Two', '', 'para', '', '- a', '- b', '', '1. x', '2. y', '',
    '> quoted', '', '---', '', '| h |', '|---|', '| c |',
  ].join('\n'));
  assert.match(out, /<h1 id="h-one">One<\/h1>/);
  assert.match(out, /<h2 id="h-two">/);
  assert.match(out, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(out, /<ol><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(out, /<blockquote>/);
  assert.match(out, /<hr>/);
  assert.match(out, /<div class="table-wrap">/, 'a wide table must scroll in its own box');
});

test('emphasis inside a code span stays literal', async () => {
  // The classic bug: parsing bold before extracting code turns `a ** b` into
  // markup. Code is pulled out first and put back last.
  const { render } = await load();
  const out = render('`a ** b` but **this** is bold');
  assert.match(out, /<code>a \*\* b<\/code>/);
  assert.match(out, /<strong>this<\/strong>/);
});

test('task lists become real checkboxes', async () => {
  const { render } = await load();
  const out = render('- [ ] open\n- [x] done');
  assert.match(out, /<input type="checkbox" disabled><span>open<\/span>/);
  assert.match(out, /checked><span>done<\/span>/);
  assert.match(out, /class="task done"/);
});

test('a fenced block records its language and is not inline-parsed', async () => {
  const { render } = await load();
  const out = render('```python\n# not a heading\n**not bold**\n```');
  assert.match(out, /data-lang="python"/);
  assert.ok(!/<h1/.test(out), 'a # inside a fence is not a heading');
  assert.ok(!/<strong>/.test(out), 'a code block does not render its own markdown');
});

// ---------- wikilinks ----------

test('a [[wikilink]] to a known slug is navigable, an unknown one is dangling', async () => {
  const { render } = await load();
  const out = render('see [[known]] and [[missing]]', { slugs: new Set(['known']) });
  assert.match(out, /<a class="wiki" data-slug="known"/);
  assert.match(out, /class="wiki dangling" data-slug="missing"/);
});

test('attic:slug handles become links too', async () => {
  const { render } = await load();
  const out = render('as recorded in attic:some-item', { slugs: new Set(['some-item']) });
  assert.match(out, /data-slug="some-item"/);
});

test('links() finds both link forms and dedupes', async () => {
  const { links } = await load();
  assert.deepEqual(links('[[a]] and attic:b and [[a]] again').sort(), ['a', 'b']);
});

test('outline() skips headings inside code fences', async () => {
  // A shell snippet full of `# comments` would otherwise fill the rail with
  // entries that are not headings at all.
  const { outline } = await load();
  const heads = outline('# Real\n\n```sh\n# not a heading\n```\n\n## Also real');
  assert.deepEqual(heads.map((h) => h.text), ['Real', 'Also real']);
  assert.deepEqual(heads.map((h) => h.level), [1, 2]);
});

// ---------- search snippets ----------

test('snippet() centres on the match, marks it, and escapes around it', async () => {
  const { snippet } = await load();
  const out = snippet('a b c the needle here and more text follows on', 'needle', 30);
  assert.match(out, /<mark>needle<\/mark>/);

  const hostile = snippet('<script>alert(1)</script> needle', 'needle', 60);
  assert.ok(!/<script/.test(hostile));
});

test('snippet() with no match still returns escaped text', async () => {
  const { snippet } = await load();
  const out = snippet('<b>hi</b> there', 'zzz', 40);
  assert.ok(!/<b>/.test(out));
  assert.ok(out.includes('&lt;b&gt;'));
});
