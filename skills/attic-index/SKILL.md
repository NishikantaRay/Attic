---
name: attic-index
description: >
  Show what is in the attic: the full INDEX.md and the last decisions. Use
  when the user asks "what's in the attic", "list stashed items", or
  "show the index".
disable-model-invocation: true
license: MIT
---

# Attic index

1. If `.attic/INDEX.md` does not exist, reply: "Attic is empty. Nothing
   stashed yet in this project." and stop.
2. Print `.attic/INDEX.md` as-is inside a fenced block.
3. If `.attic/DECISIONS.md` exists, print its last ten lines under a
   "Recent decisions" line.
4. Add one line with the counts: items, decisions.

No commentary beyond that.
