---
name: attic-help
description: One-screen reference for the attic commands and levels.
disable-model-invocation: true
version: 1.1.0
license: MIT
---

Print exactly the following, nothing else:

```
Attic · offload context into .attic/, keep the chat lean

/attic [lite|full|ultra|off]   set level (default: full)
/attic default <level>         make a level the default for new sessions
/attic-stash [title]           stash the latest finding / result / decision
/attic-recall <slug|words>     pull an item back and summarise it
/attic-index                   list everything stashed in this project
/attic-sweep                   save plan + open questions + state; run before /compact
/attic-pin <slug> [--unpin]    always inject this item, never trim it
/attic-prune [--apply]         archive stale items (dry run by default)
/attic-doctor                  check .attic/ for drift, orphans and leaked secrets
/attic-help                    this screen

Levels
  lite   stash only when asked or at task end
  full   stash after every investigation, point at handles, never repeat
  ultra  stash everything non-trivial, replies are handle + 3 lines
  off    dormant

Layout   .attic/INDEX.md · .attic/DECISIONS.md · .attic/items/<slug>.md
         .attic/archive/<slug>.md  (recallable, not injected)
Index    pinned items first, then newest; older items collapse to a summary
Handle   attic:<slug>
Env      ATTIC_DEFAULT_MODE=lite|full|ultra|off
Script   skills/attic/scripts/attic.js (stash|recall|index|validate|init)
```
