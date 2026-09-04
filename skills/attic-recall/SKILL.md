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
version: 1.2.0
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
