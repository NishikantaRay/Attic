---
name: attic-recall
description: >
  Pull ONE item back out of .attic/ by slug or search words and summarise it.
  Use when the question names a TOPIC: "what did we find about X", "recall
  X", "what's in the attic about X", or when the user references an
  attic:<slug> handle. A question with no topic that just asks what the attic
  contains goes to attic-index instead.
version: 1.2.0
license: MIT
---

# Recall from the attic

First, in the same shell command as anything below, locate the script:

```bash
ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)
```

Query: `$ARGUMENTS`.

```bash
node "$ATTIC_JS" recall "$ARGUMENTS"
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
