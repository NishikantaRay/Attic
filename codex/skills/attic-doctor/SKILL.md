---
name: attic-doctor
description: >
  Check the CONTENTS of .attic/ for drift: orphaned items, stale index
  lines, malformed frontmatter, oversized hooks, and leaked credentials. Use
  when the user says "check the attic", "attic doctor", "is the attic
  healthy", or "did anything leak into the attic". Never use this for git,
  merge or conflict problems, even though they sound like breakage: every
  merge conflict goes to attic-git.
version: 1.2.0
license: MIT
---

# Attic doctor

First, in the same shell command as anything below, locate the script:

```bash
ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)
```

```bash
node "$ATTIC_JS" validate
```

Exit 0 is healthy. Exit 3 means errors were found.

Report what it printed, then act:

| Problem | Fix |
|---|---|
| INDEX line points at a missing item file | Remove the line, or restore the item if it was deleted by mistake. |
| Item file not listed in INDEX.md | Run `attic.js rebuild` to regenerate the index from the item files. |
| Missing or malformed frontmatter | Repair the file to match `references/item-format.md`. |
| Hook over 100 chars | Shorten it; the index is injected into every session. |
| Possible credential | **Stop.** Tell the user which file and line, recommend rotating the credential, and remove the value from the item. If `.attic/` is committed, it is in git history too. |

If the index is badly out of step with the items (many orphans, or it has
been hand-edited into garbage), rebuild it rather than fixing lines one by
one. Items are the source of truth; the index is derived:

```bash
node "$ATTIC_JS" rebuild --dry-run
node "$ATTIC_JS" rebuild
```

Do not bulk-delete items to make the check pass. Ask before removing
anything the user did not create in this session.
