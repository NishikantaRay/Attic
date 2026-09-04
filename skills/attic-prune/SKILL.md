---
name: attic-prune
description: >
  Find stale attic items and archive them. Use when the user says "prune the
  attic", "the attic is getting big", "clean up old items", or "archive old
  findings". This is about the ATTIC's own contents, never about cleaning up
  source code.
argument-hint: "[--older-than 90d] [--kind output] [--apply]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" *) Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js"*)
version: 1.2.0
license: MIT
---

# Prune the attic

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" prune $ARGUMENTS
```

**Dry run is the default.** The command lists candidates and moves nothing
until `--apply` is passed.

1. Run it without `--apply` first, always. Show the candidate list.
2. Archiving is not deletion: items move to `.attic/archive/`, stay
   recallable by `/attic-recall`, and simply stop being injected. Say this,
   because "prune" sounds destructive and users hesitate.
3. Ask for confirmation before `--apply`. Never apply in the same turn the
   user first mentions pruning, unless they explicitly said to go ahead.
4. Pinned items are skipped automatically. Report how many were skipped.
5. Restore anything with
   `node .../attic.js archive <slug> --restore`.

Defaults to items older than 90 days. `--kind output` is the safest filter,
since stale command output ages worst.

Never delete an item file. Never pass `--apply` without the user having seen
the candidate list.
