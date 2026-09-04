---
name: attic-doctor
description: >
  Check the CONTENTS of .attic/ for drift: orphaned items, stale index
  lines, malformed frontmatter, oversized hooks, and leaked credentials. Use
  when the user says "check the attic", "attic doctor", "is the attic
  healthy", or "did anything leak into the attic". Never use this for git,
  merge or conflict problems, even though they sound like breakage: every
  merge conflict goes to attic-git.
disable-model-invocation: true
allowed-tools: Bash(node:*attic.js*)
version: 1.1.0
license: MIT
---

# Attic doctor

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" validate
```

Exit 0 is healthy. Exit 3 means errors were found.

Report what it printed, then act:

| Problem | Fix |
|---|---|
| INDEX line points at a missing item file | Remove the line, or restore the item if it was deleted by mistake. |
| Item file not listed in INDEX.md | Re-stash it so the index line is regenerated. |
| Missing or malformed frontmatter | Repair the file to match `references/item-format.md`. |
| Hook over 100 chars | Shorten it; the index is injected into every session. |
| Possible credential | **Stop.** Tell the user which file and line, recommend rotating the credential, and remove the value from the item. If `.attic/` is committed, it is in git history too. |

Do not bulk-delete items to make the check pass. Ask before removing
anything the user did not create in this session.
