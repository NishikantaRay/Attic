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
