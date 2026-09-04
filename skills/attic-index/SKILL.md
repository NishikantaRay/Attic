---
name: attic-index
description: >
  List everything in the attic. Use for questions about the attic's CONTENTS
  as a whole with no particular topic: "what's in the attic", "what have you
  stashed", "list stashed items", "show the index", "how many items are in
  the attic". A question about a specific topic goes to attic-recall instead;
  this skill answers "what is in there", not "what did we find about X".
disable-model-invocation: true
allowed-tools: Bash(node:*attic.js*)
version: 1.1.0
license: MIT
---

# Attic index

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" index
```

Print the output as-is. If the script reports no `.attic/`, reply "Attic is
empty. Nothing stashed yet in this project." and stop.

No commentary beyond that.
