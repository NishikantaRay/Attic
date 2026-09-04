---
name: attic-help
description: One-screen reference for the attic commands and levels.
disable-model-invocation: true
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
/attic-help                    this screen

Levels
  lite   stash only when asked or at task end
  full   stash after every investigation, point at handles, never repeat
  ultra  stash everything non-trivial, replies are handle + 3 lines
  off    dormant

Layout   .attic/INDEX.md · .attic/DECISIONS.md · .attic/items/<slug>.md
Handle   attic:<slug>
Env      ATTIC_DEFAULT_MODE=lite|full|ultra|off
```
