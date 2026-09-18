#!/usr/bin/env node
'use strict';
/**
 * attic.js — deterministic operations on .attic/.
 *
 * The model decides WHAT is worth stashing and writes the prose.
 * This script owns everything mechanical: slug hygiene, frontmatter,
 * INDEX/DECISIONS bookkeeping, secret detection, atomic writes.
 *
 * Usage:
 *   attic.js stash --slug <s> --kind <k> --hook <h> [--title <t>] [--tags a,b]
 *                  [--body-file <f> | --body <text>] [--decision-why <w>] [--json]
 *   attic.js edit --slug <s> [--title <t>] [--kind <k>] [--hook <h>] [--tags a,b]
 *                 [--body-file <f> | --body <text>] [--json]
 *                 (replaces the item; stash on an existing slug appends instead)
 *   attic.js recall <query> [--json] [--no-freshness]
 *   attic.js index [--json] [--limit N]
 *   attic.js review [--limit N] [--all] [--json]
 *   attic.js verify <slug> [--stale] [--confidence c] [--files a,b] [--note t]
 *   attic.js validate [--json]
 *   attic.js init
 *
 * Trust metadata (1.6), all optional on stash:
 *   --type finding|decision|note|failed-approach|workaround
 *   --confidence unknown|unverified|verified   (default: unverified)
 *   --files a.js,b.js      repo-relative evidence, used for freshness
 *   --commands "cmd"       newline-separated; secret-bearing lines are dropped
 *   --source-url https://  http(s) only
 *
 * Exit codes: 0 ok, 1 usage/not-found, 2 refused (secret detected), 3 validation failed.
 */
const fs = require('fs');
const path = require('path');
const freshness = require('./freshness.js');

const KINDS = ['finding', 'decision', 'plan', 'output', 'note'];
const HOOK_MAX = 100;

// ---------- trust vocabulary (1.6) ----------
// `type` is deliberately a SEPARATE field from `kind` rather than more values
// for it. The INDEX line matches kind as ([a-z]+) — no hyphen — and that regex
// is duplicated in hooks/attic-runtime.js and in the generated codex/ copy. A
// `failed-approach` in the kind position would not match, and an unupgraded
// reader would drop the line silently rather than fail loudly. Missing
// knowledge with no error is the exact outcome Attic exists to prevent.
const TYPES = ['finding', 'decision', 'note', 'failed-approach', 'workaround'];
const CONFIDENCES = ['unknown', 'unverified', 'verified'];
const FRESHNESSES = ['unknown', 'current', 'possibly-stale', 'needs-review'];

// Which `type` a given `kind` implies, when the caller names only a kind. Only
// where the mapping is unambiguous: `plan` and `output` have no type of their
// own, and guessing one would be inventing metadata.
const KIND_TO_TYPE = { finding: 'finding', decision: 'decision', note: 'note' };

const MAX_FILES = 20;
const MAX_COMMANDS = 10;

/**
 * Commands are stored so a later reader can re-run the evidence. That makes
 * them a place a credential can land — `curl -H "Authorization: Bearer ..."`
 * is a command someone genuinely ran. They go through the same scan the body
 * does, and a command carrying a secret is dropped rather than refused: the
 * finding itself is still worth keeping, and losing one evidence line is a far
 * better outcome than either writing the token or rejecting the stash.
 */
function safeCommands(list) {
  const out = [];
  for (const raw of list) {
    const c = oneLine(raw);
    if (!c) continue;
    if (scanSecrets(c).length) continue;
    // A command line is evidence, not a script. Cap it so a pasted heredoc
    // cannot push the frontmatter past the size the index budget assumes.
    out.push(c.length > 200 ? c.slice(0, 199) + '…' : c);
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

// ---------- paths ----------
function atticRoot(cwd) { return path.join(cwd || process.cwd(), '.attic'); }
const P = (cwd) => ({
  root: atticRoot(cwd),
  items: path.join(atticRoot(cwd), 'items'),
  archive: path.join(atticRoot(cwd), 'archive'),
  index: path.join(atticRoot(cwd), 'INDEX.md'),
  decisions: path.join(atticRoot(cwd), 'DECISIONS.md'),
});

// ---------- helpers ----------
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function today() { return new Date().toISOString().slice(0, 10); }
function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// Cap a hook at HOOK_MAX, breaking on a word boundary when one is close.
function truncateHook(s) {
  // The index line is delimited by " · " and markdown link syntax, so a hook
  // containing those could forge a second entry. Neutralise them.
  const t = oneLine(s).replace(/·/g, '-').replace(/[\[\]()]/g, '');
  if (t.length <= HOOK_MAX) return t;
  const cut = t.slice(0, HOOK_MAX - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > HOOK_MAX * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '\u2026';
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * Run fn while holding an exclusive lock on `file`.
 *
 * INDEX.md and DECISIONS.md are read-modify-write, so two agents stashing at
 * once would each read the same index and the second write would drop the
 * first one's line. mkdir is atomic on every platform we target, so it is the
 * lock primitive. A stale lock older than 10s is broken, since the only work
 * under the lock is a read plus a rename.
 */
function withLock(file, fn) {
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 5000;
  let acquired = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      acquired = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmdirSync(lock); continue; }
      } catch (e2) { continue; }
      if (Date.now() > deadline) break; // proceed rather than fail the stash
      // Busy-wait briefly; these holds are sub-millisecond.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try { return fn(); }
  // Only release a lock we hold. On the timeout path someone else owns it.
  finally { if (acquired) { try { fs.rmdirSync(lock); } catch (e) { /* already released */ } } }
}

// ---------- secret detection (mechanical, not model judgement) ----------
const SECRET_PATTERNS = [
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/, 'API key (sk- prefix)'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub personal access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/, 'connection string with password'],
  // An assigned credential LITERAL. A finding that says how a secret is
  // loaded ("api_key = process.env.API_KEY", "password = getPassword(user)")
  // is exactly the kind of thing worth stashing, so code-shaped values are
  // not flagged: only a quoted string, or a bare token with a digit in it.
  [/(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(?:["'](?!(?:<|\$|\{|xxx|placeholder|redacted|your[_-]|example|changeme|\*+|\.\.\.))[^"'\n]{8,}["']|(?![A-Za-z_][\w]*(?:[.(\[]))(?!(?:<|\$|\{|xxx|placeholder|redacted|your[_-]|example|changeme|\*+|\.\.\.))(?=[^\s"'`,;]*\d)[A-Za-z0-9_\-+/=]{8,})/i, 'assigned credential'],
];

function scanSecrets(text) {
  const hits = [];
  for (const [re, label] of SECRET_PATTERNS) {
    const m = String(text || '').match(re);
    if (m) {
      const line = String(text).slice(0, m.index).split('\n').length;
      hits.push({ label, line });
    }
  }
  return hits;
}

// ---------- frontmatter ----------
function parseFrontmatter(raw) {
  const m = String(raw).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(raw) };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

// Fields this renderer positions explicitly, in this order. Everything else a
// caller put on `meta` is written after them, so the renderer is no longer a
// filter that silently drops what it does not recognise.
const CORE_FIELDS = ['title', 'kind', 'date', 'tags'];
// Trust metadata (1.6). Ordered so an item reads top-down as: what it is, how
// far to trust it, where the knowledge came from.
const TRUST_FIELDS = ['type', 'confidence', 'freshness', 'status',
  'revision', 'verified_at', 'files', 'commands', 'source_url'];
const LIST_FIELDS = new Set(['tags', 'files', 'commands']);

function renderValue(key, v) {
  if (LIST_FIELDS.has(key)) {
    const list = Array.isArray(v) ? v : (v ? [v] : []);
    return `[${list.join(', ')}]`;
  }
  return String(v);
}

/**
 * Render frontmatter + body.
 *
 * Until 1.6 this hard-coded its field list, which made it a filter: a key it
 * did not know about was dropped on the next write. Since `pin`, `edit` and
 * `archive` all round-trip an item through here, an unrelated `/attic-pin`
 * would have erased any metadata this function had not been taught about.
 * That is why unknown keys are now carried through verbatim — a reader newer
 * than this one must be able to add a field without a passing pin quietly
 * deleting it.
 */
function renderItem(meta, body) {
  const lines = ['---'];
  const written = new Set();
  const put = (k, v) => { lines.push(`${k}: ${renderValue(k, v)}`); written.add(k); };

  // Core fields keep their exact historical order and are always present, so
  // a 1.5 reader sees byte-identical frontmatter for an item with no trust
  // metadata on it.
  put('title', meta.title);
  put('kind', meta.kind);
  put('date', meta.date);
  put('tags', meta.tags);

  // `pinned` stays immediately after the core block: hooks/attic-runtime.js
  // only reads the first 512 bytes of an item looking for it, so pushing it
  // below a long files/commands list would make pinned items look unpinned.
  if (meta.pinned === true || meta.pinned === 'true') put('pinned', true);

  for (const k of TRUST_FIELDS) {
    if (written.has(k)) continue;
    const v = meta[k];
    if (v === undefined || v === null || v === '') continue;
    if (LIST_FIELDS.has(k) && Array.isArray(v) && !v.length) continue;
    put(k, v);
  }

  // Anything else the caller carried. Unknown does not mean unwanted.
  for (const k of Object.keys(meta)) {
    if (written.has(k) || k === 'pinned') continue;
    const v = meta[k];
    if (v === undefined || v === null || v === '') continue;
    put(k, v);
  }

  return lines.concat([
    '---',
    '',
    String(body).trim(),
    '',
  ]).join('\n');
}

// ---------- index ----------
const INDEX_HEADER = '# Attic index\n\n';
const INDEX_LINE = /^- \[([^\]]+)\]\(items\/([^)]+)\.md\) · ([a-z]+) · (.*)$/;

function readIndexLines(cwd) {
  const p = P(cwd);
  let raw;
  try { raw = fs.readFileSync(p.index, 'utf8'); } catch (e) { return []; }
  return raw.split('\n').map((l) => l.trim()).filter((l) => INDEX_LINE.test(l));
}

function parseIndexLine(line) {
  const m = line.match(INDEX_LINE);
  return m ? { slug: m[2], label: m[1], kind: m[3], hook: m[4] } : null;
}

function upsertIndexLine(cwd, entry) {
  const p = P(cwd);
  const line = `- [${entry.slug}](items/${entry.slug}.md) · ${entry.kind} · ${entry.hook}`;
  return withLock(p.index, () => {
    const existing = readIndexLines(cwd).filter((l) => {
      const e = parseIndexLine(l);
      return e && e.slug !== entry.slug;
    });
    existing.push(line);
    writeAtomic(p.index, INDEX_HEADER + existing.join('\n') + '\n');
    return line;
  });
}

function appendDecision(cwd, decision, why) {
  const p = P(cwd);
  const line = `- ${today()} · ${oneLine(decision)} · because ${oneLine(why)}`;
  return withLock(p.decisions, () => {
    let raw = '';
    try { raw = fs.readFileSync(p.decisions, 'utf8'); } catch (e) { raw = '# Decisions\n\n'; }
    if (!raw.endsWith('\n')) raw += '\n';
    writeAtomic(p.decisions, raw + line + '\n');
    return line;
  });
}

// ---------- provenance (1.6) ----------
/**
 * Reject an unknown --type or --confidence rather than quietly ignoring it.
 *
 * A silently dropped `--confidence verifed` writes an item the caller believes
 * is marked verified and which recall will report as unverified. Trust
 * metadata that lies in the safe direction is still metadata that lies, and it
 * is worth one round trip to say so.
 */
function checkVocab(args) {
  if (args.type !== undefined && !TYPES.includes(String(args.type).toLowerCase())) {
    return `--type must be one of ${TYPES.join(', ')}`;
  }
  if (args.confidence !== undefined && !CONFIDENCES.includes(String(args.confidence).toLowerCase())) {
    return `--confidence must be one of ${CONFIDENCES.join(', ')}`;
  }
  return null;
}

/**
 * Build the trust metadata for a new item from what is actually knowable.
 *
 * The rule this function exists to enforce: **provenance is never invented.**
 * A value that cannot be determined is left off the item entirely rather than
 * written as a guess, because an absent field reads as "unknown" while a
 * fabricated one reads as evidence. Saving an item is not evidence that its
 * contents were checked, so nothing here ever defaults confidence to
 * `verified` — that claim has to be made explicitly by the caller.
 */
function buildProvenance(cwd, args, kind) {
  const meta = {};

  const type = args.type ? String(args.type).toLowerCase() : KIND_TO_TYPE[kind];
  if (type && TYPES.includes(type)) meta.type = type;

  // Least-assumptive default. An agent that has actually checked its
  // conclusion against the code passes --confidence verified; everything else
  // is unverified, including anything a human typed in by hand.
  const conf = args.confidence ? String(args.confidence).toLowerCase() : 'unverified';
  if (CONFIDENCES.includes(conf)) meta.confidence = conf;

  // Only repo-relative paths, so the item stays portable and does not publish
  // the author's home directory into a file the team commits.
  const files = [];
  for (const f of String(args.files || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const rel = freshness.toRepoRelative(cwd, f);
    if (rel && !files.includes(rel)) files.push(rel);
    if (files.length >= MAX_FILES) break;
  }
  if (files.length) meta.files = files;

  const commands = safeCommands(String(args.commands || '').split('\n'));
  if (commands.length) meta.commands = commands;

  // Only http(s). A file: or javascript: URL in an item that the browser
  // library later renders is a liability, and neither is a real source.
  if (args['source-url'] && /^https?:\/\/\S+$/i.test(String(args['source-url']).trim())) {
    meta.source_url = oneLine(args['source-url']);
  }

  // Git is optional. Outside a repository there is simply no revision, and the
  // item is still a perfectly good note.
  const rev = freshness.isGitRepo(cwd) ? freshness.currentRevision(cwd) : null;
  if (rev) meta.revision = rev;

  if (meta.confidence === 'verified') meta.verified_at = today();

  return meta;
}

// ---------- commands ----------
function cmdInit(cwd) {
  const p = P(cwd);
  fs.mkdirSync(p.items, { recursive: true });
  if (!fs.existsSync(p.index)) writeAtomic(p.index, INDEX_HEADER);
  if (!fs.existsSync(p.decisions)) writeAtomic(p.decisions, '# Decisions\n\n');
  return { ok: true, root: p.root };
}

function cmdStash(cwd, args) {
  const slug = slugify(args.slug || args.title);
  if (!slug) return { ok: false, error: 'a --slug or --title is required' };
  const kind = String(args.kind || 'finding').toLowerCase();
  if (!KINDS.includes(kind)) return { ok: false, error: `--kind must be one of ${KINDS.join(', ')}` };
  const vocabError = checkVocab(args);
  if (vocabError) return { ok: false, error: vocabError };

  let body = args.body || '';
  if (args['body-file']) {
    try { body = fs.readFileSync(args['body-file'], 'utf8'); }
    catch (e) { return { ok: false, error: `cannot read --body-file ${args['body-file']}` }; }
  }
  if (!oneLine(body)) return { ok: false, error: 'empty body: pass --body or --body-file' };

  // Hook length is formatting, not judgement: truncate rather than reject, so
  // an over-long hook never costs a round trip. The index is injected into
  // every session, so this cap is load-bearing.
  const hook = truncateHook(args.hook || body);

  const secrets = scanSecrets(body + '\n' + hook);
  if (secrets.length && !args.force) {
    return {
      ok: false, refused: true,
      error: `refusing to stash: ${secrets.map((s) => `${s.label} (line ${s.line})`).join(', ')}. Redact it, then retry.`,
    };
  }

  cmdInit(cwd);
  const p = P(cwd);
  const file = path.join(p.items, slug + '.md');
  const provenance = buildProvenance(cwd, args, kind);
  const meta = Object.assign({
    title: oneLine(args.title || slug.replace(/-/g, ' ')),
    kind, date: today(),
    tags: args.tags ? String(args.tags).split(',').map((t) => slugify(t)).filter(Boolean) : [],
  }, provenance);

  let appended = false;
  if (fs.existsSync(file)) {
    const prev = fs.readFileSync(file, 'utf8');
    const parsed = parseFrontmatter(prev);
    const merged = parsed.body.trim() + `\n\n## Update ${today()}\n\n` + String(body).trim();
    const keepMeta = Object.assign({}, parsed.meta, { kind, date: today() });
    if (meta.tags.length) {
      const old = Array.isArray(parsed.meta.tags) ? parsed.meta.tags : [];
      keepMeta.tags = Array.from(new Set(old.concat(meta.tags)));
    }
    // An append is new evidence about the same subject, so the provenance
    // moves forward with it: a fresh revision, and any newly named files or
    // commands unioned onto what was already there. Evidence is only ever
    // added on this path — an update that happens not to mention a file is not
    // a statement that the file stopped being relevant.
    for (const k of ['files', 'commands']) {
      if (!provenance[k]) continue;
      const old = Array.isArray(parsed.meta[k]) ? parsed.meta[k] : (parsed.meta[k] ? [parsed.meta[k]] : []);
      keepMeta[k] = Array.from(new Set(old.concat(provenance[k])));
    }
    for (const k of ['type', 'source_url']) {
      if (provenance[k] && !keepMeta[k]) keepMeta[k] = provenance[k];
    }
    if (provenance.revision) keepMeta.revision = provenance.revision;
    // Confidence is only restated when the caller said so on this call.
    // Re-stashing does not promote an item, and it does not demote one that
    // was previously verified either.
    if (args.confidence && provenance.confidence) {
      keepMeta.confidence = provenance.confidence;
      if (provenance.verified_at) keepMeta.verified_at = provenance.verified_at;
      else delete keepMeta.verified_at;
    }
    // The body changed, so a stored freshness verdict computed against the old
    // body no longer describes this item. Drop it and let recall recompute.
    delete keepMeta.freshness;
    writeAtomic(file, renderItem(keepMeta, merged));
    appended = true;
  } else {
    writeAtomic(file, renderItem(meta, body));
  }

  const line = upsertIndexLine(cwd, { slug, kind, hook });
  const out = { ok: true, slug, handle: `attic:${slug}`, file: path.relative(cwd, file), appended, indexLine: line };
  if (kind === 'decision' || args['decision-why']) {
    out.decisionLine = appendDecision(cwd, args.title || slug.replace(/-/g, ' '), args['decision-why'] || hook);
  }
  return out;
}

/**
 * Replace an existing item in place.
 *
 * This is NOT cmdStash. Stashing an existing slug appends a dated
 * `## Update` section, which is the right behaviour for an agent adding to a
 * finding and the wrong behaviour for a human editing one: an editor that
 * appends on every save turns one item into a pile of near-duplicates.
 *
 * It lives here rather than in the extension server so the frontmatter
 * format, the secret scan, the hook cap and the atomic write stay in exactly
 * one place. A second writer that formats its own frontmatter is how the two
 * drift apart.
 */
function cmdEdit(cwd, args) {
  const slug = slugify(args.slug || args._ && args._[0]);
  if (!slug) return { ok: false, error: 'a --slug is required' };
  const found = findItem(cwd, slug);
  if (!found) return { ok: false, error: `no item "${slug}" in the attic` };

  const prev = parseFrontmatter(fs.readFileSync(found.file, 'utf8'));
  let body = args.body !== undefined ? String(args.body) : prev.body;
  // Same escape hatch stash has: a replacement body is often longer than a
  // shell argument wants to be.
  if (args['body-file']) {
    try { body = fs.readFileSync(args['body-file'], 'utf8'); }
    catch (e) { return { ok: false, error: `cannot read --body-file ${args['body-file']}` }; }
  }
  if (!oneLine(body)) return { ok: false, error: 'empty body: an edit may not blank an item' };

  const kind = String(args.kind || prev.meta.kind || 'note').toLowerCase();
  if (!KINDS.includes(kind)) return { ok: false, error: `--kind must be one of ${KINDS.join(', ')}` };

  // An edit is a write of user-supplied text, so it gets the same scan a stash
  // gets. Skipping it here would make "edit" the way to smuggle a credential
  // past the check.
  const hook = truncateHook(args.hook !== undefined ? args.hook : (readHook(cwd, slug) || body));
  const secrets = scanSecrets(body + '\n' + hook);
  if (secrets.length && !args.force) {
    return {
      ok: false, refused: true,
      error: `refusing to save: ${secrets.map((s) => `${s.label} (line ${s.line})`).join(', ')}. Redact it, then retry.`,
    };
  }

  // The original date is kept: an item's date is when it was learned, not when
  // a typo in it was fixed.
  const meta = Object.assign({}, prev.meta, {
    title: oneLine(args.title || prev.meta.title || slug.replace(/-/g, ' ')),
    kind,
    date: prev.meta.date || today(),
  });
  if (args.tags !== undefined) {
    meta.tags = String(args.tags).split(',').map((t) => slugify(t)).filter(Boolean);
  }
  writeAtomic(found.file, renderItem(meta, String(body).trim()));

  // An archived item is not in the index, so editing one must not put it back.
  if (!found.archived) upsertIndexLine(cwd, { slug, kind, hook });
  return {
    ok: true, slug, handle: `attic:${slug}`,
    file: path.relative(cwd, found.file), archived: found.archived, edited: true,
  };
}

// The hook lives in INDEX.md, not in the item, so an edit that does not pass
// one has to read the current line back rather than invent a new hook from the
// body and silently rewrite it.
function readHook(cwd, slug) {
  const line = readIndexLines(cwd).map(parseIndexLine).find((e) => e && e.slug === slug);
  return line ? line.hook : '';
}

function cmdRecall(cwd, query, args = {}) {
  const p = P(cwd);
  if (!fs.existsSync(p.index)) return { ok: false, error: 'no .attic/ in this project yet' };
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: false, error: 'a search query is required' };

  const entries = readIndexLines(cwd).map(parseIndexLine).filter(Boolean);
  // Archived items stay recallable even though they left the index.
  try {
    for (const f of fs.readdirSync(p.archive).filter((x) => x.endsWith('.md'))) {
      const slug = f.replace(/\.md$/, '');
      if (!entries.some((e) => e.slug === slug)) {
        const meta = parseFrontmatter(fs.readFileSync(path.join(p.archive, f), 'utf8')).meta;
        entries.push({ slug, label: slug, kind: meta.kind || 'note', hook: meta.title || slug, archived: true });
      }
    }
  } catch (e) { /* no archive */ }
  const exact = entries.find((e) => e.slug === slugify(q));
  const scored = [];
  const words = q.split(/\s+/).filter(Boolean);
  for (const e of entries) {
    const f = findItem(cwd, e.slug);
    let text = '';
    try { text = f ? fs.readFileSync(f.file, 'utf8').toLowerCase() : ''; } catch (err) { /* stale index line */ }
    let score = 0;
    for (const w of words) {
      if (e.slug.includes(w)) score += 3;
      if (e.hook.toLowerCase().includes(w)) score += 2;
      if (text.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = exact ? { entry: exact, score: 99 } : scored[0];
  if (!best) return { ok: false, error: `nothing in the attic matches "${query}"`, candidates: [] };

  const found = findItem(cwd, best.entry.slug);
  if (!found) return { ok: false, error: `index lists ${best.entry.slug} but its item file is missing` };
  const file = found.file;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(content);
  const out = {
    ok: true, slug: best.entry.slug, handle: `attic:${best.entry.slug}`,
    file: path.relative(cwd, file), meta: parsed.meta, body: parsed.body.trim(),
    alternatives: scored.slice(0, 4).map((s) => s.entry.slug).filter((s) => s !== best.entry.slug),
  };
  // Freshness is computed for the one item being recalled, never for the whole
  // attic: this is the only place a git call is worth making, and it is two
  // calls scoped to that item's own file list.
  if (!args['no-freshness']) {
    out.freshness = freshness.evaluate(cwd, parsed.meta, { archived: found.archived });
    out.recommendation = freshness.recommendation(out.freshness);
  }
  return out;
}

function cmdIndex(cwd, args) {
  const p = P(cwd);
  if (!fs.existsSync(p.index)) return { ok: false, error: 'no .attic/ in this project yet' };
  const entries = readIndexLines(cwd).map(parseIndexLine).filter(Boolean);
  let decisions = [];
  try {
    decisions = fs.readFileSync(p.decisions, 'utf8').split('\n').filter((l) => l.startsWith('- '));
  } catch (e) { /* none yet */ }
  const limit = args.limit ? parseInt(args.limit, 10) : entries.length;
  return {
    ok: true,
    counts: { items: entries.length, decisions: decisions.length },
    items: entries.slice(-limit),
    recentDecisions: decisions.slice(-10),
  };
}

function cmdValidate(cwd) {
  const p = P(cwd);
  const problems = [];
  if (!fs.existsSync(p.root)) return { ok: true, problems, note: 'no .attic/ in this project' };

  const entries = readIndexLines(cwd).map(parseIndexLine).filter(Boolean);
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.slug)) problems.push({ level: 'error', slug: e.slug, msg: 'duplicate INDEX line' });
    seen.add(e.slug);
    if (e.hook.length > HOOK_MAX) problems.push({ level: 'warn', slug: e.slug, msg: `hook is ${e.hook.length} chars (max ${HOOK_MAX})` });
    if (!KINDS.includes(e.kind)) problems.push({ level: 'error', slug: e.slug, msg: `unknown kind "${e.kind}"` });
    if (!fs.existsSync(path.join(p.items, e.slug + '.md'))) problems.push({ level: 'error', slug: e.slug, msg: 'INDEX line points at a missing item file' });
  }

  let files = [];
  try { files = fs.readdirSync(p.items).filter((f) => f.endsWith('.md')); } catch (e) { /* no items dir */ }
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const full = path.join(p.items, f);
    const raw = fs.readFileSync(full, 'utf8');
    if (!seen.has(slug)) problems.push({ level: 'error', slug, msg: 'item file is not listed in INDEX.md' });
    const { meta } = parseFrontmatter(raw);
    for (const field of ['title', 'kind', 'date']) {
      if (!meta[field]) problems.push({ level: 'error', slug, msg: `frontmatter is missing ${field}` });
    }
    if (meta.kind && !KINDS.includes(meta.kind)) problems.push({ level: 'error', slug, msg: `unknown kind "${meta.kind}"` });
    if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) problems.push({ level: 'error', slug, msg: `date "${meta.date}" is not YYYY-MM-DD` });

    // Trust metadata is optional, so absence is never a problem. A PRESENT but
    // unrecognised value is, because these strings are printed into an agent's
    // context as if they meant something: a hand-edited `confidence: bogus`
    // reads to a model exactly like a real verdict. Warn rather than error —
    // the item's knowledge is still intact and still worth keeping.
    for (const [field, allowed] of [['type', TYPES], ['confidence', CONFIDENCES], ['freshness', FRESHNESSES]]) {
      if (meta[field] && !allowed.includes(String(meta[field]))) {
        problems.push({ level: 'warn', slug, msg: `unknown ${field} "${meta[field]}" (expected one of ${allowed.join(', ')})` });
      }
    }
    if (meta.verified_at && !/^\d{4}-\d{2}-\d{2}$/.test(meta.verified_at)) {
      problems.push({ level: 'warn', slug, msg: `verified_at "${meta.verified_at}" is not YYYY-MM-DD` });
    }
    // An absolute path in `files` is a privacy problem, not a cosmetic one: it
    // names the author's machine layout in a file teams commit, and it breaks
    // on clone.
    for (const f of (Array.isArray(meta.files) ? meta.files : [])) {
      if (path.isAbsolute(f)) problems.push({ level: 'warn', slug, msg: `files entry "${f}" is an absolute path; it should be repo-relative` });
    }
    if (slug !== slugify(slug)) problems.push({ level: 'warn', slug, msg: 'filename is not a clean slug' });
    for (const hit of scanSecrets(raw)) problems.push({ level: 'error', slug, msg: `possible ${hit.label} at line ${hit.line}` });
  }
  return { ok: problems.filter((x) => x.level === 'error').length === 0, problems };
}

function itemPath(cwd, slug, archived) {
  const p = P(cwd);
  return path.join(archived ? p.archive : p.items, slug + '.md');
}

function findItem(cwd, slug) {
  const live = itemPath(cwd, slug, false);
  if (fs.existsSync(live)) return { file: live, archived: false };
  const arch = itemPath(cwd, slug, true);
  if (fs.existsSync(arch)) return { file: arch, archived: true };
  return null;
}

function cmdPin(cwd, args) {
  const slug = slugify(args._[0] || args.slug);
  if (!slug) return { ok: false, error: 'a slug is required' };
  const found = findItem(cwd, slug);
  if (!found) return { ok: false, error: `no item "${slug}" in the attic` };
  const parsed = parseFrontmatter(fs.readFileSync(found.file, 'utf8'));
  const pin = !args.unpin;
  const meta = Object.assign({}, parsed.meta, { pinned: pin });
  if (!pin) delete meta.pinned;
  writeAtomic(found.file, renderItem(meta, parsed.body));
  return { ok: true, slug, pinned: pin, handle: `attic:${slug}`, archived: found.archived };
}

function cmdArchive(cwd, args) {
  const slug = slugify(args._[0] || args.slug);
  if (!slug) return { ok: false, error: 'a slug is required' };
  const p = P(cwd);
  const restore = !!args.restore;
  // Archiving moves live -> archive; restoring moves archive -> live.
  const from = itemPath(cwd, slug, restore);
  const to = itemPath(cwd, slug, !restore);
  if (!fs.existsSync(from)) {
    return { ok: false, error: `no ${restore ? 'archived' : 'live'} item "${slug}"` };
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);

  // An archived item leaves the index; a restored one rejoins it. The read
  // happens under the same lock as the write, or a concurrent stash between
  // the two would be lost.
  withLock(p.index, () => {
    const kept = readIndexLines(cwd).filter((l) => {
      const e = parseIndexLine(l);
      return e && e.slug !== slug;
    });
    if (restore) {
      const parsed = parseFrontmatter(fs.readFileSync(to, 'utf8'));
      kept.push(`- [${slug}](items/${slug}.md) · ${parsed.meta.kind || 'note'} · ${truncateHook(parsed.meta.title || slug)}`);
    }
    writeAtomic(p.index, INDEX_HEADER + kept.join('\n') + (kept.length ? '\n' : ''));
  });
  return { ok: true, slug, handle: `attic:${slug}`, archived: !restore, file: path.relative(cwd, to) };
}

function parseAge(spec) {
  const m = String(spec || '').match(/^(\d+)\s*([dwmy])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { d: 1, w: 7, m: 30, y: 365 }[m[2].toLowerCase()];
  return n * mult;
}

// Prune never deletes. It reports candidates, and only with --apply does it
// move them to .attic/archive/, where recall can still reach them.
function cmdPrune(cwd, args) {
  const p = P(cwd);
  if (!fs.existsSync(p.index)) return { ok: false, error: 'no .attic/ in this project yet' };
  const days = args['older-than'] ? parseAge(args['older-than']) : 90;
  if (days === null) return { ok: false, error: '--older-than takes a value like 90d, 6m or 1y' };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const kindFilter = args.kind ? String(args.kind).toLowerCase() : null;
  if (kindFilter && !KINDS.includes(kindFilter)) return { ok: false, error: `--kind must be one of ${KINDS.join(', ')}` };

  const pinned = new Set();
  const candidates = [];
  for (const e of readIndexLines(cwd).map(parseIndexLine).filter(Boolean)) {
    const file = itemPath(cwd, e.slug, false);
    let meta = {};
    try { meta = parseFrontmatter(fs.readFileSync(file, 'utf8')).meta; } catch (err) { continue; }
    if (meta.pinned === 'true' || meta.pinned === true) { pinned.add(e.slug); continue; }
    if (kindFilter && meta.kind !== kindFilter) continue;
    if (!meta.date || meta.date >= cutoff) continue;
    candidates.push({ slug: e.slug, kind: meta.kind, date: meta.date, hook: e.hook });
  }

  const apply = !!args.apply;
  if (apply) for (const c of candidates) cmdArchive(cwd, { _: [c.slug] });
  return {
    ok: true, cutoff, days, applied: apply,
    skippedPinned: pinned.size,
    candidates,
    note: apply ? `archived ${candidates.length} item(s) to .attic/archive/`
                : 'dry run: nothing moved. Re-run with --apply to archive these.',
  };
}

/**
 * List items whose knowledge may no longer match the tree.
 *
 * Read-only by design. Review reports; `verify` and `archive` act. Splitting
 * them is the point: a command that both finds stale knowledge and decides
 * what to do with it would be rewriting the user's memory on a heuristic, and
 * a heuristic about whether a conclusion still holds is exactly the thing this
 * release refuses to guess at.
 *
 * The cost of this command IS proportional to the attic, unlike recall — it
 * has to look at every item to find the stale ones. That is why freshness is
 * computed here and on recall, and nowhere else: nothing on the session-start
 * path or in the index shells out to git.
 */
function cmdReview(cwd, args) {
  const p = P(cwd);
  if (!fs.existsSync(p.index)) return { ok: false, error: 'no .attic/ in this project yet' };

  // A malformed --limit must not silently render as an empty attic: NaN slices
  // to nothing, which reads exactly like "nothing needs review" — the most
  // misleading possible answer from this command.
  let limit = 20;
  if (args.limit !== undefined && args.limit !== true) {
    limit = parseInt(args.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) {
      return { ok: false, error: '--limit takes a positive whole number' };
    }
  }
  const entries = readIndexLines(cwd).map(parseIndexLine).filter(Boolean);
  const rows = [];
  let current = 0;
  for (const e of entries) {
    const found = findItem(cwd, e.slug);
    if (!found) continue;
    let meta = {};
    try { meta = parseFrontmatter(fs.readFileSync(found.file, 'utf8')).meta; } catch (err) { continue; }
    const f = freshness.evaluate(cwd, meta, { archived: found.archived });
    if (f.status === 'current') { current++; continue; }
    // An item with no 1.6 metadata is not "needing review"; it is simply from
    // before the feature existed. Surfacing every pre-1.6 item as a problem on
    // first upgrade would make the command useless on the attics that already
    // exist, so unknown is only reported when asked for.
    const pre16 = !meta.revision && !meta.files && !meta.type && !meta.confidence;
    if (f.status === 'unknown' && pre16 && !args.all) continue;
    rows.push({
      slug: e.slug, kind: e.kind, hook: e.hook,
      type: meta.type || null, confidence: meta.confidence || null,
      status: f.status, reason: f.reason,
      changedFiles: f.changedFiles, missingFiles: f.missingFiles,
      recordedRevision: f.recordedRevision, currentRevision: f.currentRevision,
    });
  }

  const order = { 'needs-review': 0, 'possibly-stale': 1, unknown: 2, archived: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return {
    ok: true, total: entries.length, current,
    needingReview: rows.length, items: rows.slice(0, limit),
    truncated: Math.max(0, rows.length - limit),
  };
}

/**
 * Record that a human or an agent checked an item against the current tree.
 *
 * This is the only way `confidence: verified` and a fresh revision get onto an
 * existing item, and it is deliberately an explicit act. Nothing in Attic
 * promotes an item to verified on its own — if staleness could be cleared by
 * anything other than someone actually looking, the freshness signal would
 * decay into noise within a few sessions.
 *
 * The item's PROSE is never touched. Verification restamps provenance; if the
 * conclusion itself changed, that is a stash (which appends an update) or an
 * edit, not this.
 */
function cmdVerify(cwd, args) {
  const slug = slugify(args._ && args._[0] || args.slug);
  if (!slug) return { ok: false, error: 'a slug is required' };
  const found = findItem(cwd, slug);
  if (!found) return { ok: false, error: `no item "${slug}" in the attic` };
  const vocabError = checkVocab(args);
  if (vocabError) return { ok: false, error: vocabError };

  const parsed = parseFrontmatter(fs.readFileSync(found.file, 'utf8'));
  const meta = Object.assign({}, parsed.meta);

  // --stale records the opposite verdict: someone looked and it does NOT hold
  // any more. It is still not a deletion, and still does not touch the prose.
  if (args.stale) {
    meta.freshness = 'needs-review';
    delete meta.verified_at;
  } else {
    meta.confidence = args.confidence ? String(args.confidence).toLowerCase() : 'verified';
    meta.verified_at = today();
    // The whole point of verifying is to move the baseline forward, so the
    // next freshness check compares against what was actually looked at.
    const rev = freshness.isGitRepo(cwd) ? freshness.currentRevision(cwd) : null;
    if (rev) meta.revision = rev;
    // A stored needs-review was an instruction to look. That has now happened.
    if (meta.freshness === 'needs-review') delete meta.freshness;
  }

  // New evidence may be named at verification time.
  if (args.files) {
    const files = Array.isArray(meta.files) ? meta.files.slice() : (meta.files ? [meta.files] : []);
    for (const f of String(args.files).split(',').map((x) => x.trim()).filter(Boolean)) {
      const rel = freshness.toRepoRelative(cwd, f);
      if (rel && !files.includes(rel)) files.push(rel);
      if (files.length >= MAX_FILES) break;
    }
    if (files.length) meta.files = files;
  }
  if (args.note) {
    const n = oneLine(args.note);
    if (scanSecrets(n).length) return { ok: false, refused: true, error: 'refusing to record a --note containing a credential.' };
  }

  const body = args.note
    ? parsed.body.trim() + `\n\n## ${args.stale ? 'Flagged' : 'Verified'} ${today()}\n\n${oneLine(args.note)}`
    : parsed.body.trim();

  writeAtomic(found.file, renderItem(meta, body));
  return {
    ok: true, slug, handle: `attic:${slug}`,
    file: path.relative(cwd, found.file),
    confidence: meta.confidence || null,
    revision: meta.revision || null,
    flagged: !!args.stale,
  };
}

// Rebuild INDEX.md from the item files on disk. The items are the source of
// truth; the index is a derived cache, so it can always be regenerated.
function cmdRebuild(cwd, args) {
  const p = P(cwd);
  if (!fs.existsSync(p.items)) return { ok: false, error: 'no .attic/items/ in this project' };
  const existing = new Map();
  for (const l of readIndexLines(cwd)) {
    const e = parseIndexLine(l);
    if (e) existing.set(e.slug, e.hook);
  }

  const rows = [];
  for (const f of fs.readdirSync(p.items).filter((x) => x.endsWith('.md')).sort()) {
    const slug = f.replace(/\.md$/, '');
    let meta = {}, body = '';
    try {
      const parsed = parseFrontmatter(fs.readFileSync(path.join(p.items, f), 'utf8'));
      meta = parsed.meta; body = parsed.body;
    } catch (e) { continue; }
    const kind = KINDS.includes(meta.kind) ? meta.kind : 'note';
    // Prefer the hook already in the index; fall back to title, then body.
    const hook = existing.get(slug) || truncateHook(meta.title || body || slug);
    rows.push({ slug, kind, hook, date: meta.date || '' });
  }
  rows.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : String(a.date).localeCompare(String(b.date))));

  const lines = rows.map((r) => `- [${r.slug}](items/${r.slug}.md) · ${r.kind} · ${r.hook}`);
  const recovered = rows.filter((r) => !existing.has(r.slug)).map((r) => r.slug);
  const dropped = [...existing.keys()].filter((s) => !rows.some((r) => r.slug === s));

  if (args['dry-run']) {
    return { ok: true, applied: false, items: rows.length, recovered, dropped,
             note: 'dry run: nothing written. Re-run without --dry-run to apply.' };
  }
  withLock(p.index, () => writeAtomic(p.index, INDEX_HEADER + lines.join('\n') + (lines.length ? '\n' : '')));
  return { ok: true, applied: true, items: rows.length, recovered, dropped,
           note: `INDEX.md rebuilt from ${rows.length} item file(s).` };
}

// ---------- cli ----------
const FLAGS = ['slug', 'kind', 'hook', 'title', 'tags', 'body', 'body-file',
  'decision-why', 'cwd', 'limit', 'suite', 'case', 'claude', 'out', 'older-than',
  'type', 'confidence', 'files', 'commands', 'source-url', 'status', 'note'];
const BOOLS = ['json', 'force', 'dry-run', 'unpin', 'restore', 'apply',
  'stale', 'all', 'no-freshness'];

// Only a recognised --name is a flag. Anything else is a value, so bodies
// starting with "-----BEGIN ... KEY-----" or "--foo" survive intact.
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && BOOLS.includes(name)) { args[name] = true; continue; }
    if (name && FLAGS.includes(name)) {
      const next = argv[i + 1];
      const nextName = next && next.startsWith('--') ? next.slice(2) : null;
      if (next === undefined || (nextName && (FLAGS.includes(nextName) || BOOLS.includes(nextName)))) args[name] = true;
      else { args[name] = next; i++; }
      continue;
    }
    args._.push(a);
  }
  return args;
}

/**
 * The trust header shown above a recalled item's body.
 *
 * Two constraints fight here. Recall output is injected into a model's
 * context, so every line costs tokens on every recall; but a stale finding
 * reused as fact is the failure this release exists to prevent. The
 * resolution: a `current` item with nothing notable spends ONE line, and the
 * multi-line warning block is spent only when there is something to act on.
 *
 * An item carrying no 1.6 metadata at all — every item stashed before this
 * release — produces nothing, so recall on an existing attic looks exactly as
 * it did in 1.5 rather than sprouting a column of "unknown".
 */
function trustBlock(r) {
  const m = r.meta || {};
  const f = r.freshness;
  const facts = [];
  // Only recognised vocabulary is echoed. A hand-edited `confidence: bogus`
  // reads to a model exactly like a real verdict, so an unknown value is
  // dropped here and reported by `validate` instead.
  if (m.type && TYPES.includes(String(m.type))) facts.push(m.type);
  if (m.confidence && CONFIDENCES.includes(String(m.confidence))) facts.push(m.confidence);
  if (f && f.status !== 'unknown') facts.push(f.status);

  const lines = [];
  if (facts.length) lines.push(facts.join(' · '));
  if (m.revision) lines.push(`revision: ${m.revision}` + (f && f.currentRevision && f.currentRevision !== m.revision ? ` (now ${f.currentRevision})` : ''));

  const evidence = Array.isArray(m.files) ? m.files : (m.files ? [m.files] : []);
  if (evidence.length) {
    // Bounded: an item may name up to MAX_FILES, and recall is not the place
    // to print all of them.
    const shown = evidence.slice(0, 6);
    lines.push(`evidence: ${shown.join(', ')}` + (evidence.length > shown.length ? ` (+${evidence.length - shown.length} more)` : ''));
  }
  if (m.source_url) lines.push(`source: ${m.source_url}`);

  // The warning is spent only where it changes what the reader should do.
  if (f && (f.status === 'possibly-stale' || f.status === 'needs-review')) {
    lines.push('');
    lines.push(f.status === 'possibly-stale' ? '⚠ Possibly stale' : '⚠ Needs review');
    if (f.reason) lines.push(f.reason);
    lines.push(freshness.recommendation(f));
  }

  return lines.length ? lines.join('\n') + '\n' : '';
}

function human(cmd, r) {
  // validate reports problems rather than an error string; render them.
  if (!r.ok && cmd === 'validate' && Array.isArray(r.problems)) {
    return r.problems.map((p) => `${p.level.toUpperCase()} ${p.slug}: ${p.msg}`).join('\n');
  }
  if (!r.ok) return (r.refused ? 'REFUSED: ' : 'error: ') + r.error;
  switch (cmd) {
    case 'init': return `attic ready at ${r.root}`;
    case 'stash': return `Stashed \`${r.handle}\`${r.appended ? ' (appended)' : ''} -> ${r.file}`;
    case 'recall': {
      const alt = r.alternatives.length ? `\n(also matched: ${r.alternatives.join(', ')})` : '';
      return `# ${r.meta.title}\nkind: ${r.meta.kind} · date: ${r.meta.date} · \`${r.handle}\`\n` +
             trustBlock(r) + `\n${r.body}${alt}`;
    }
    case 'index': {
      const lines = r.items.map((e) => `- [${e.slug}](items/${e.slug}.md) · ${e.kind} · ${e.hook}`);
      const dec = r.recentDecisions.length ? `\n\nRecent decisions:\n${r.recentDecisions.join('\n')}` : '';
      return `${lines.join('\n') || '(empty)'}${dec}\n\n${r.counts.items} item(s), ${r.counts.decisions} decision(s)`;
    }
    case 'edit': return `Saved \`${r.handle}\` -> ${r.file}${r.archived ? ' (archived)' : ''}`;
    case 'pin': return `${r.pinned ? 'Pinned' : 'Unpinned'} \`${r.handle}\``;
    case 'archive': return r.archived
      ? `Archived \`${r.handle}\` -> ${r.file}. Still recallable, no longer injected.`
      : `Restored \`${r.handle}\` -> ${r.file}.`;
    case 'prune': {
      if (!r.candidates.length) return `Nothing older than ${r.days} day(s) to prune.` + (r.skippedPinned ? ` (${r.skippedPinned} pinned item(s) skipped)` : '');
      const rows = r.candidates.map((c) => `  ${c.date}  ${c.kind.padEnd(8)} ${c.slug}`);
      return `Candidates older than ${r.cutoff} (${r.candidates.length}):\n${rows.join('\n')}` +
             (r.skippedPinned ? `\n${r.skippedPinned} pinned item(s) skipped.` : '') + `\n\n${r.note}`;
    }
    case 'review': {
      if (!r.needingReview) {
        return `Nothing needs review. ${r.current} of ${r.total} item(s) check out against the current tree.`;
      }
      const rows = r.items.map((i) => {
        const tags = [i.type, i.confidence, i.status].filter(Boolean).join(' · ');
        return `[${i.slug}] ${i.hook}\n  ${tags}\n  ${i.reason}`;
      });
      const more = r.truncated ? `\n\n(+${r.truncated} more; --limit to see them)` : '';
      return `${r.needingReview} item(s) need review:\n\n${rows.join('\n\n')}${more}\n\n` +
             `Act with: attic.js verify <slug>   (checked, still holds)\n` +
             `          attic.js verify <slug> --stale   (checked, no longer holds)\n` +
             `          attic.js archive <slug>   (obsolete; still recallable)`;
    }
    case 'verify': return r.flagged
      ? `Flagged \`${r.handle}\` as needing review. Its text is unchanged.`
      : `Verified \`${r.handle}\`${r.revision ? ` at ${r.revision}` : ''} (confidence: ${r.confidence}).`;
    case 'rebuild': {
      const parts = [r.note];
      if (r.recovered.length) parts.push(`recovered into the index: ${r.recovered.join(', ')}`);
      if (r.dropped.length) parts.push(`dropped stale index line(s): ${r.dropped.join(', ')}`);
      return parts.join('\n');
    }
    case 'validate': {
      if (!r.problems.length) return 'attic is valid' + (r.note ? ` (${r.note})` : '');
      return r.problems.map((p) => `${p.level.toUpperCase()} ${p.slug}: ${p.msg}`).join('\n');
    }
    default: return JSON.stringify(r, null, 2);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const cwd = args.cwd || process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.cwd();
  let r;
  try {
  switch (cmd) {
    case 'init': r = cmdInit(cwd); break;
    case 'stash': r = cmdStash(cwd, args); break;
    case 'recall': r = cmdRecall(cwd, args._.join(' '), args); break;
    case 'index': r = cmdIndex(cwd, args); break;
    case 'validate': r = cmdValidate(cwd); break;
    case 'pin': r = cmdPin(cwd, args); break;
    case 'archive': r = cmdArchive(cwd, args); break;
    case 'edit': r = cmdEdit(cwd, args); break;
    case 'prune': r = cmdPrune(cwd, args); break;
    case 'review': r = cmdReview(cwd, args); break;
    case 'verify': r = cmdVerify(cwd, args); break;
    case 'rebuild': r = cmdRebuild(cwd, args); break;
    default:
      process.stderr.write('usage: attic.js <init|stash|edit|recall|index|validate|pin|archive|prune|review|verify|rebuild> [options]\n');
      process.exit(1);
  }
  } catch (e) {
    // A filesystem failure is a real answer, not a crash: report it plainly.
    const why = e.code === 'EACCES' || e.code === 'EPERM' ? 'permission denied'
      : e.code === 'ENOSPC' ? 'no space left on device'
      : e.code === 'EROFS' ? 'read-only filesystem'
      : e.message;
    r = { ok: false, error: `${cmd} failed: ${why}` };
  }
  process.stdout.write((args.json ? JSON.stringify(r, null, 2) : human(cmd, r)) + '\n');
  if (!r.ok) process.exit(r.refused ? 2 : (cmd === 'validate' ? 3 : 1));
}

if (require.main === module) main();
module.exports = { cmdEdit, cmdReview, cmdVerify, buildProvenance, trustBlock, safeCommands, checkVocab, TYPES, CONFIDENCES, FRESHNESSES, freshness, slugify, truncateHook, scanSecrets, withLock, cmdPin, cmdArchive, cmdPrune, cmdRebuild, findItem, parseFrontmatter, renderItem, cmdInit, cmdStash, cmdRecall, cmdIndex, cmdValidate, parseIndexLine, KINDS };
