---
name: attic-recall
description: >
  Pull an item back out of .attic/ by slug or search words and summarise it.
  Use when the user asks "what did we find about X", "recall X", "what's in
  the attic about X", or references an attic:<slug> handle.
argument-hint: "<slug or search words>"
license: MIT
---

# Recall from the attic

Query: `$ARGUMENTS`.

1. If `.attic/INDEX.md` does not exist, say so in one line and stop.
2. If the query matches a slug exactly, read `.attic/items/<slug>.md`.
   Otherwise grep INDEX.md and the `title:` lines of `.attic/items/*.md`
   case-insensitively for the query words and pick the best match. If
   several match equally, list them as handles and ask which one.
3. Report the item in at most ten lines: title, kind, date, then the
   substance. Keep code, paths and commands verbatim.
4. End with the handle: `` `attic:<slug>` ``.

Do not rewrite or delete items while recalling.
