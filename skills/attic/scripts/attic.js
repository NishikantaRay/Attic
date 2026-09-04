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
 *   attic.js recall <query> [--json]
 *   attic.js index [--json] [--limit N]
 *   attic.js validate [--json]
 *   attic.js init
 *
 * Exit codes: 0 ok, 1 usage/not-found, 2 refused (secret detected), 3 validation failed.
 */
const fs = require('fs');
const path = require('path');

const KINDS = ['finding', 'decision', 'plan', 'output', 'note'];
const HOOK_MAX = 100;

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
  const t = oneLine(s);
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
  [/(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?(?!\s*$)(?!(?:<|\$|\{|xxx|placeholder|redacted|your[_-]|example|changeme|\*+|\.\.\.))[^\s"'`,;]{8,}/i, 'assigned credential'],
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

function renderItem(meta, body) {
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const lines = [
    '---',
    `title: ${meta.title}`,
    `kind: ${meta.kind}`,
    `date: ${meta.date}`,
    `tags: [${tags.join(', ')}]`,
  ];
  if (meta.pinned === true || meta.pinned === 'true') lines.push('pinned: true');
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
  const existing = readIndexLines(cwd).filter((l) => {
    const e = parseIndexLine(l);
    return e && e.slug !== entry.slug;
  });
  existing.push(line);
  writeAtomic(p.index, INDEX_HEADER + existing.join('\n') + '\n');
  return line;
}

function appendDecision(cwd, decision, why) {
  const p = P(cwd);
  const line = `- ${today()} · ${oneLine(decision)} · because ${oneLine(why)}`;
  let raw = '';
  try { raw = fs.readFileSync(p.decisions, 'utf8'); } catch (e) { raw = '# Decisions\n\n'; }
  if (!raw.endsWith('\n')) raw += '\n';
  writeAtomic(p.decisions, raw + line + '\n');
  return line;
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
  const meta = {
    title: oneLine(args.title || slug.replace(/-/g, ' ')),
    kind, date: today(),
    tags: args.tags ? String(args.tags).split(',').map((t) => slugify(t)).filter(Boolean) : [],
  };

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

function cmdRecall(cwd, query) {
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
  return {
    ok: true, slug: best.entry.slug, handle: `attic:${best.entry.slug}`,
    file: path.relative(cwd, file), meta: parsed.meta, body: parsed.body.trim(),
    alternatives: scored.slice(0, 4).map((s) => s.entry.slug).filter((s) => s !== best.entry.slug),
  };
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

  // An archived item leaves the index; a restored one rejoins it.
  const kept = readIndexLines(cwd).filter((l) => {
    const e = parseIndexLine(l);
    return e && e.slug !== slug;
  });
  if (restore) {
    const parsed = parseFrontmatter(fs.readFileSync(to, 'utf8'));
    kept.push(`- [${slug}](items/${slug}.md) · ${parsed.meta.kind || 'note'} · ${truncateHook(parsed.meta.title || slug)}`);
  }
  writeAtomic(p.index, INDEX_HEADER + kept.join('\n') + (kept.length ? '\n' : ''));
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

// ---------- cli ----------
const FLAGS = ['slug', 'kind', 'hook', 'title', 'tags', 'body', 'body-file',
  'decision-why', 'cwd', 'limit', 'suite', 'case', 'claude', 'out', 'older-than'];
const BOOLS = ['json', 'force', 'dry-run', 'unpin', 'restore', 'apply'];

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

function human(cmd, r) {
  if (!r.ok) return (r.refused ? 'REFUSED: ' : 'error: ') + r.error;
  switch (cmd) {
    case 'init': return `attic ready at ${r.root}`;
    case 'stash': return `Stashed \`${r.handle}\`${r.appended ? ' (appended)' : ''} -> ${r.file}`;
    case 'recall': {
      const alt = r.alternatives.length ? `\n(also matched: ${r.alternatives.join(', ')})` : '';
      return `# ${r.meta.title}\nkind: ${r.meta.kind} · date: ${r.meta.date} · \`${r.handle}\`\n\n${r.body}${alt}`;
    }
    case 'index': {
      const lines = r.items.map((e) => `- [${e.slug}](items/${e.slug}.md) · ${e.kind} · ${e.hook}`);
      const dec = r.recentDecisions.length ? `\n\nRecent decisions:\n${r.recentDecisions.join('\n')}` : '';
      return `${lines.join('\n') || '(empty)'}${dec}\n\n${r.counts.items} item(s), ${r.counts.decisions} decision(s)`;
    }
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
  const cwd = args.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let r;
  switch (cmd) {
    case 'init': r = cmdInit(cwd); break;
    case 'stash': r = cmdStash(cwd, args); break;
    case 'recall': r = cmdRecall(cwd, args._.join(' ')); break;
    case 'index': r = cmdIndex(cwd, args); break;
    case 'validate': r = cmdValidate(cwd); break;
    case 'pin': r = cmdPin(cwd, args); break;
    case 'archive': r = cmdArchive(cwd, args); break;
    case 'prune': r = cmdPrune(cwd, args); break;
    default:
      process.stderr.write('usage: attic.js <init|stash|recall|index|validate|pin|archive|prune> [options]\n');
      process.exit(1);
  }
  process.stdout.write((args.json ? JSON.stringify(r, null, 2) : human(cmd, r)) + '\n');
  if (!r.ok) process.exit(r.refused ? 2 : (cmd === 'validate' ? 3 : 1));
}

if (require.main === module) main();
module.exports = { slugify, truncateHook, scanSecrets, cmdPin, cmdArchive, cmdPrune, findItem, parseFrontmatter, renderItem, cmdInit, cmdStash, cmdRecall, cmdIndex, cmdValidate, parseIndexLine, KINDS };
