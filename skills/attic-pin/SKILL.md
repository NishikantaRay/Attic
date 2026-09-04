---
name: attic-pin
description: >
  Pin an attic item so it is always injected into new sessions and never
  trimmed when the index outgrows its budget. Use when the user says "pin
  this", "always remember this", "keep this in context", or when an item is
  a long-lived architectural decision or constraint that must survive.
  Use --unpin to reverse it.
argument-hint: "<slug> [--unpin]"
allowed-tools: Bash(node:*attic.js*)
version: 1.1.0
license: MIT
---

# Pin an attic item

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" pin $ARGUMENTS
```

Pinned items occupy a reserved share of the injected index, so they survive
even when hundreds of newer items exist. That budget is finite: pin the
handful of things that must always be in context, not everything important.

Good candidates: an architectural decision the whole project depends on, a
constraint that is easy to forget, the location of something non-obvious.

Bad candidates: a finding about code that changes weekly, anything already
obvious from the repository.

Reply in one line with what was pinned and the current pinned count from
`/attic-index`. If the user is pinning a fifth or later item, say plainly
that the pinned tier is small and ask which one should be unpinned.
