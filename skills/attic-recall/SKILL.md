---
name: attic-recall
description: >
  Pull ONE item back out of .attic/ by slug or search words and summarise it.
  Use when the question names a TOPIC: "what did we find about X", "recall
  X", "what's in the attic about X", or when the user references an
  attic:<slug> handle. A question with no topic that just asks what the attic
  contains goes to attic-index instead.
argument-hint: "<slug or search words>"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" *) Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js"*)
version: 1.6.0
license: MIT
---

# Recall from the attic

Query: `$ARGUMENTS`.

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" recall "$ARGUMENTS"
```

The script scores slug, index hook and item body, returns the best match, and
lists alternatives.

1. No `.attic/` yet, or nothing matches: say so in one line and stop. Do not
   invent an answer or go read source files unless the user asks.
2. Several plausible matches: report the best one, then list the alternative
   handles in one line so the user can redirect.
3. Report the item in at most ten lines. Keep code, paths and commands
   verbatim. End with the handle.

Never rewrite or delete items while recalling.

## Freshness

Recall prints a trust line above the body, and for anything that is not
current, a warning with the reason. Pass it on — an item's staleness is part
of the item, and dropping it while quoting the conclusion is the failure this
release exists to prevent.

| What recall says | What you do |
|---|---|
| `current` | Use it. Mention the item is current only if asked. |
| `possibly-stale` | Quote it, then say which files changed and that it needs checking before it is relied on. |
| `needs-review` | As above, and do not present the claim as fact. A cited file may be gone. |
| `unverified` | Say it was recorded but never checked. |
| no trust line at all | An item from before 1.6. Treat its provenance as unknown, not as verified. |

The distinction to hold on to: `possibly-stale` means **a file underneath this
finding moved**, not that the finding is false. Report it as something to
check, never as something that is now wrong — you have not checked it either.

If the user acts on a stale item, offer to verify it against the current code
and record the result with `/attic-review`. Recall itself never writes.
