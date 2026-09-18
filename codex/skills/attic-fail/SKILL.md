---
name: attic-fail
description: >
  Record an approach that was tried and did not work, so nobody repeats it.
  Use when the user says "that didn't work", "this approach failed", "record
  this failure", "don't try this again", "note what we ruled out", or when an
  attempt in this session was abandoned for a reason worth keeping. Also use
  for a temporary workaround that should not be mistaken for a real fix.
version: 1.6.0
license: MIT
---

# Record a failed approach

First, in the same shell command as anything below, locate the script:

```bash
ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)
```

Argument: `$ARGUMENTS` (a title, or empty to use the last failed attempt).

A failed approach is worth more than it looks. The next session will consider
the same idea for the same reasons, and the record of why it did not work is
what stops the second attempt from costing what the first one did.

## What to capture

Four things, in this order. The third is the one that matters — an approach
recorded without its reason just reads as defeatism and gets re-tried anyway.

1. **What was tried** — concretely enough to recognise the idea again.
2. **What happened** — the actual failure, error text copied verbatim.
3. **Why it failed** — the underlying reason, not the symptom.
4. **What to do instead**, if known.

## Recording it

```bash
node "$ATTIC_JS" stash \
  --slug <slug> --kind finding --type failed-approach \
  --title "<what was tried>" \
  --hook "<the approach, and the one-line reason it failed>" \
  --files "<files that show why>" \
  [--commands "<command that demonstrated the failure>"] \
  [--confidence verified] \
  --body-file <tmpfile>
```

`--type failed-approach` is what keeps it out of the way of active
architectural decisions: it is recorded knowledge about a dead end, not a
recommendation. Pass `--confidence verified` only if you actually saw it fail
in this session; an approach you believe would fail is `unverified`, and the
body should say which it was.

For a temporary fix that works but should not last, use
`--type workaround` instead. Workarounds are always surfaced by
`/attic-review`, because a workaround that quietly becomes permanent is its
own kind of failure.

## Body shape

```markdown
## Tried
Added authentication directly inside the route handler.

## Result
Some routes bypassed the handler entirely; `npm test` failed 3 auth tests.

## Why it failed
Auth must run before route registration, and the handler runs after it.

## Instead
Register the middleware in src/middleware/auth.ts before the route table.
```

## Reply

`` Recorded `attic:<slug>` · <one line on why it failed> ``
