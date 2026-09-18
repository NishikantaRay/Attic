'use strict';
/**
 * freshness.js — does a stashed finding still match the working tree?
 *
 * The question this module answers is deliberately narrow: **has anything the
 * finding depends on moved since it was recorded?** It never answers "is the
 * finding still true". A changed file means the conclusion needs a look, not
 * that it is wrong, and nothing here ever rewrites an item's prose.
 *
 * Git is optional everywhere. A project with no repository, no commits, or no
 * git binary is a normal Attic project; it simply gets `unknown` freshness
 * instead of a computed one. Nothing in this file throws for ordinary missing
 * metadata — an item with no revision and no files is not an error, it is an
 * item recorded before 1.6.
 *
 * Cost: at most two git calls per evaluation, both bounded to the item's own
 * file list. Freshness is computed for the item being recalled, not for the
 * whole attic.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATUSES = ['current', 'possibly-stale', 'needs-review', 'unknown', 'archived'];

// A finding recorded as a workaround is never "current" in the sense the other
// types are: it is by definition provisional, so it always asks for a look.
const ALWAYS_REVIEW_TYPES = new Set(['workaround']);

/**
 * Run a git command, returning null instead of throwing.
 *
 * Every failure mode collapses to null on purpose: git missing from PATH, the
 * directory not being a repository, a repository with no commits, a corrupt
 * object store. The caller cannot act differently on any of them — all of them
 * mean "git cannot tell us", which is `unknown`.
 */
function git(cwd, args, timeoutMs = 2000, raw = false) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
    // `raw` matters for --porcelain, whose status field is two columns wide and
    // may begin with a space (" M path"). Trimming that output shifts the first
    // record left by one and reports "rc/auth.js" for "src/auth.js".
    return raw ? String(out) : String(out).trim();
  } catch (e) {
    return null;
  }
}

function isGitRepo(cwd) {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/** Absolute path of the repository root, or null outside a repository. */
function repoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  return r || null;
}

/**
 * Short SHA of HEAD, or null.
 *
 * Null covers a repository with no commits yet, which is a real state a user
 * can stash from (`git init` then work before the first commit). Detached HEAD
 * is NOT a special case here: a detached HEAD still has a resolvable SHA, and
 * the SHA is the only thing freshness compares.
 */
function currentRevision(cwd) {
  return git(cwd, ['rev-parse', '--short', 'HEAD']);
}

/**
 * Turn a path into one relative to the repository root, with forward slashes.
 *
 * Storing absolute paths would leak the author's home directory into a file
 * people commit and share, and would break the moment the repository is cloned
 * somewhere else. A path outside the repository is returned as-is rather than
 * as a `../../..` chain that says where the repo sits on this machine.
 */
function toRepoRelative(cwd, file) {
  const f = String(file || '').trim();
  if (!f) return '';
  const root = repoRoot(cwd) || cwd;
  const abs = path.isAbsolute(f) ? f : path.resolve(cwd, f);

  // Both sides are resolved through realpath before comparing. On macOS a temp
  // directory is handed out as /var/... while `git rev-parse --show-toplevel`
  // reports the symlink target /private/var/..., so comparing the two raw
  // strings yields a "../.." chain and the absolute path would be stored —
  // leaking the machine layout into a file people commit. Symlinked checkouts
  // hit the same case outside tests.
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return p; } };
  const rel = path.relative(real(root), real(abs));
  if (!rel || rel.startsWith('..')) return f.replace(/\\/g, '/');
  return rel.split(path.sep).join('/');
}

/** Does a git revision still exist in this repository? */
function revisionExists(cwd, rev) {
  if (!rev) return false;
  return git(cwd, ['cat-file', '-e', `${rev}^{commit}`]) !== null;
}

/**
 * Which of `files` changed between `rev` and the working tree?
 *
 * Two questions, because they have different answers:
 *   - committed drift:   git diff --name-only <rev> HEAD -- <files>
 *   - uncommitted drift: git status --porcelain -- <files>
 *
 * Both are scoped to the item's own paths, so the cost does not grow with the
 * size of the repository. A rename shows up as the old path disappearing and
 * the new one appearing, which is enough to ask for a review; git's own
 * rename detection is deliberately not relied on, since it is heuristic and a
 * wrong guess here would be presented to the user as fact.
 */
function changedFiles(cwd, rev, files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return { committed: [], uncommitted: [] };

  let committed = [];
  if (rev && revisionExists(cwd, rev)) {
    const out = git(cwd, ['diff', '--name-only', rev, 'HEAD', '--'].concat(list));
    committed = out ? out.split('\n').filter(Boolean) : [];
  }

  // -z is not cosmetic. Without it git quotes and backslash-escapes any path
  // containing a space or a non-ASCII byte, so a plain split would report a
  // mangled filename; and the XY status field is exactly two columns followed
  // by one space, so the path begins at byte 3 with no trimming — trimming
  // would eat the first character of a path whose status is " M".
  const st = git(cwd, ['status', '--porcelain', '-z', '--'].concat(list), 2000, true);
  const uncommitted = st
    ? st.split('\0').filter(Boolean)
        .map((rec) => rec.slice(3))
        .filter(Boolean)
    : [];

  return { committed, uncommitted };
}

/** Referenced files that are no longer on disk. */
function missingFiles(cwd, files) {
  const root = repoRoot(cwd) || cwd;
  return (files || []).filter((f) => {
    if (!f) return false;
    return !fs.existsSync(path.resolve(root, f));
  });
}

function asList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v === undefined || v === null || v === '') return [];
  return [String(v)];
}

/**
 * Evaluate one item's freshness.
 *
 * Returns a structured result; never throws for missing metadata. The `status`
 * vocabulary is fixed (STATUSES) so that callers can format it without
 * interpreting free text.
 *
 * The policy, stated once so the tests and the docs can both point at it:
 *
 *   - archived item                        -> archived
 *   - type is a workaround                 -> needs-review (provisional by nature)
 *   - not a git repo / no revision stored  -> unknown
 *   - a referenced file is gone            -> needs-review (strongest signal)
 *   - a referenced file changed            -> possibly-stale
 *   - revision moved, referenced files did -> current  (see below)
 *   - nothing moved                        -> current
 *
 * That second-to-last line is the load-bearing policy choice. A repository
 * that has moved on is not evidence about a finding whose files nobody
 * touched; treating every commit anywhere as staleness would mark the whole
 * attic stale after one unrelated merge, and a warning that is always on is a
 * warning nobody reads. An item that names NO files has nothing to scope the
 * question to, so a moved revision does downgrade it to possibly-stale.
 */
function evaluate(cwd, meta, opts = {}) {
  const m = meta || {};
  const files = asList(m.files);
  const recordedRevision = m.revision ? String(m.revision) : null;

  const base = {
    status: 'unknown',
    reason: '',
    changedFiles: [],
    missingFiles: [],
    recordedRevision,
    currentRevision: null,
    files,
  };

  if (opts.archived || m.status === 'archived') {
    return Object.assign(base, { status: 'archived', reason: 'item is archived' });
  }

  // An explicit freshness in the frontmatter is a human's or an agent's
  // considered answer. Only `needs-review` is honoured as an override, because
  // it is the conservative direction: someone asking for a review gets one.
  // A stored `current` is NOT trusted over the working tree — that is exactly
  // the stale-cache failure this feature exists to prevent.
  if (String(m.freshness || '') === 'needs-review') {
    return Object.assign(base, { status: 'needs-review', reason: 'marked for review' });
  }

  if (ALWAYS_REVIEW_TYPES.has(String(m.type || ''))) {
    return Object.assign(base, {
      status: 'needs-review',
      reason: 'recorded as a workaround, which is provisional by definition',
    });
  }

  if (!isGitRepo(cwd)) {
    return Object.assign(base, {
      status: 'unknown',
      reason: 'not a git repository, so changes cannot be detected',
    });
  }

  base.currentRevision = currentRevision(cwd);

  const gone = missingFiles(cwd, files);
  if (gone.length) {
    return Object.assign(base, {
      status: 'needs-review',
      missingFiles: gone,
      reason: `referenced file(s) no longer exist: ${gone.join(', ')}`,
    });
  }

  if (!recordedRevision) {
    // No baseline to compare against. If the item names files we still cannot
    // say when they last agreed with it, so this stays unknown rather than
    // being optimistically called current.
    return Object.assign(base, {
      status: 'unknown',
      reason: 'no revision was recorded when this item was stashed',
    });
  }

  if (!revisionExists(cwd, recordedRevision)) {
    return Object.assign(base, {
      status: 'unknown',
      reason: `recorded revision ${recordedRevision} is not in this repository`,
    });
  }

  if (!files.length) {
    if (base.currentRevision && base.currentRevision !== recordedRevision) {
      return Object.assign(base, {
        status: 'possibly-stale',
        reason: `repository moved from ${recordedRevision} to ${base.currentRevision} and this item names no files to check`,
      });
    }
    return Object.assign(base, { status: 'current', reason: 'repository has not moved' });
  }

  const { committed, uncommitted } = changedFiles(cwd, recordedRevision, files);
  const changed = Array.from(new Set(committed.concat(uncommitted)));
  if (changed.length) {
    return Object.assign(base, {
      status: 'possibly-stale',
      changedFiles: changed,
      reason: `referenced file(s) changed since ${recordedRevision}: ${changed.join(', ')}`,
    });
  }

  return Object.assign(base, {
    status: 'current',
    reason: base.currentRevision === recordedRevision
      ? 'repository has not moved'
      : 'repository moved but no referenced file changed',
  });
}

/** One-line summary for compact output. */
function short(result) {
  if (!result) return 'unknown';
  return result.status;
}

/**
 * The action a reader should take. Kept as a fixed sentence per status rather
 * than generated prose, so it never overstates what freshness actually knows.
 */
function recommendation(result) {
  switch (result && result.status) {
    case 'current': return 'Safe to reuse. Nothing it references has changed.';
    case 'possibly-stale': return 'Verify against the current working tree before reuse.';
    case 'needs-review': return 'Review this item before relying on it.';
    case 'archived': return 'Archived. Historical context only.';
    default: return 'Provenance is unknown. Confirm independently before relying on it.';
  }
}

module.exports = {
  STATUSES, evaluate, short, recommendation,
  isGitRepo, repoRoot, currentRevision, toRepoRelative, revisionExists,
  changedFiles, missingFiles, git,
};
