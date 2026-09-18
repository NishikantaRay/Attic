# Item and index format

Loaded when writing to `.attic/` by hand instead of through
`scripts/attic.js`. Prefer the script: it owns this format.

## items/&lt;slug&gt;.md

```markdown
---
title: Login test times out
kind: finding
date: 2026-09-04
tags: [tests, flaky]
---

The fixture at tests/conftest.py:41 sets timeout=5. The login flow makes a
real SMTP call taking 6-8s.

Fix: raise the timeout or mock smtplib.SMTP in the fixture.
```

Frontmatter fields are all required except `tags`. `kind` is one of
`finding`, `decision`, `plan`, `output`, `note`. `date` is `YYYY-MM-DD`.

## Trust metadata (optional, 1.6)

Written after the required fields. Every one is optional; an item without them
is valid and reads exactly as it did in 1.5.

```markdown
---
title: Auth middleware runs after route registration
kind: finding
date: 2026-09-18
tags: [auth]
type: finding
confidence: verified
revision: a1b2c3d
verified_at: 2026-09-18
files: [src/middleware/auth.ts, src/routes/index.ts]
commands: [rg "authMiddleware" src]
---
```

| Field | Values |
|---|---|
| `type` | `finding` `decision` `note` `failed-approach` `workaround` |
| `confidence` | `unknown` `unverified` `verified` |
| `freshness` | `needs-review` only; other values are computed, not stored |
| `revision` | short git SHA at the time it was recorded |
| `verified_at` | `YYYY-MM-DD` of the last explicit check |
| `files` | repo-relative paths. **Never absolute** |
| `commands` | command lines only, never their output |
| `source_url` | one `http(s)` URL, for clipped items |

The frontmatter parser is flat and line-based: `key: value`, with `[a, b]` for
lists. **Nested YAML is not supported** — a `repo:` block with indented keys
underneath will not parse. Keep every field at the top level.

`type` is separate from `kind` because the `INDEX.md` line matches kind as
`[a-z]+`; a hyphenated value there would be unreadable to older copies of the
script and the item would silently vanish from the index.

Freshness is computed at read time by comparing `revision` and `files` against
the working tree. It is not stored, because a stored verdict goes stale the
moment someone edits a file — the one failure this feature exists to prevent.

Body structure that survives re-reading:

1. What is true, stated flatly.
2. Where, with exact paths and line numbers.
3. What to do about it, if known.

Appending to an existing item adds `## Update <date>` and the new content
underneath. The script does this automatically when the slug exists.

## INDEX.md

```markdown
# Attic index

- [login-test-timeout](items/login-test-timeout.md) · finding · 5s fixture timeout in tests/conftest.py:41
- [use-lru-cache](items/use-lru-cache.md) · decision · one line beats a cache class
```

One line per item, newest last, hook under 100 characters. This file is
injected into every session start, so every character costs context on every
session. Keep hooks dense.

## DECISIONS.md

```markdown
# Decisions

- 2026-09-04 · Use lru_cache for API responses · because a hand-rolled TTL cache is a bug farm
```

Append-only. Never rewrite history here; a superseded decision gets a new
line saying it supersedes the old one.

## Verbatim rule

Code, commands, paths, line numbers and error text are copied exactly.
Paraphrasing an error message makes it ungreppable, which defeats the point.
