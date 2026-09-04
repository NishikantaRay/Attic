---
name: attic-git
description: >
  Everything about .attic/ and git: fixes merge conflicts in INDEX.md and
  DECISIONS.md by installing a union merge driver, and sets up a shared
  attic for a team. Use whenever git and .attic/ appear in the same
  problem: "merge conflicts in INDEX.md", "the attic keeps conflicting",
  "conflict in DECISIONS.md", "share the attic with my team", "commit the
  attic", "onboard someone to our attic".
version: 1.1.0
license: MIT
---

# Attic and git

`.attic/INDEX.md` and `DECISIONS.md` are append-only, so two branches that
each stash something will conflict on every merge. The fix is a union merge
driver.

1. Add to the repository's `.gitattributes` (create it if absent):

```
.attic/INDEX.md merge=attic
.attic/DECISIONS.md merge=attic
```

2. Each developer runs this once per clone. Git does not allow a repository
   to configure a driver command for security reasons, so this cannot be
   automated for them:

```bash
git config merge.attic.name "attic union merge"
git config merge.attic.driver "node <path-to-plugin>/scripts/attic-merge.js %O %A %B %P"
```

   Resolve `<path-to-plugin>` from `${CLAUDE_SKILL_DIR}/../..` and show the
   real path in the command you print.

3. Verify by describing the check, or running it in a scratch clone: two
   branches each appending an item should merge with no conflict markers.

Then tell the user what to commit, from `docs/TEAM.md`:

- **Commit** `.attic/INDEX.md`, `.attic/items/`, `.attic/DECISIONS.md` for
  shared memory.
- **Consider gitignoring** `.attic/items/session-*.md`, which are personal
  working state and rarely useful to others.
- **A committed attic is in git history.** If a credential ever reaches it,
  rotating the credential is the fix. Removing the file is not enough.

If someone declines the merge driver, warn them that conflicts on INDEX.md
will be frequent and that resolving them by picking one side silently loses
the other side's items.
