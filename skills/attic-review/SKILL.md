---
name: attic-review
description: >
  Check which stashed items may no longer match the code, and resolve them.
  Use when the user says "review the attic", "what's stale", "is the attic
  still accurate", "check the attic against the code", "verify this finding",
  or after a big refactor, rebase or merge that may have invalidated earlier
  findings. This is about whether stashed knowledge is still TRUE; use
  attic-doctor for structural damage and attic-prune for items that are merely
  old.
argument-hint: "[slug to verify]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" *) Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js"*)
version: 1.6.0
license: MIT
---

# Review the attic for stale knowledge

Argument: `$ARGUMENTS` (a slug to verify directly, or empty to list).

## Listing what needs a look

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" review
```

Each item comes back with a status and the reason for it:

| Status | Means |
|---|---|
| `possibly-stale` | A file the item cites has changed since it was recorded. |
| `needs-review` | A cited file is gone, or the item is a workaround, or someone flagged it. |
| `unknown` | No provenance to check it against. |

Items stashed before 1.6 have no provenance and are hidden by default, since
listing an entire existing attic as suspect is noise. `--all` includes them.

## What these statuses do NOT mean

`possibly-stale` means **a file moved under this finding**, not that the
finding is wrong. A rename, a reformat or an unrelated edit in the same file
all produce it. Say "may need checking", never "this is out of date" — you do
not know that yet, and the whole point of the status is to prompt a look
rather than to replace one.

## Resolving an item

Read the item (`/attic-recall <slug>`), then check its claim against the code
as it is now. Only after actually looking:

```bash
# Checked, still true. Re-stamps confidence and moves the revision baseline.
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" verify <slug> \
  --note "what you checked"

# Checked, no longer true. Flags it; the text is preserved.
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" verify <slug> --stale \
  --note "what changed"

# Obsolete. Leaves the index, stays recallable.
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" archive <slug>
```

Never run `verify` without having read the code it refers to. It records that
someone checked; running it to clear a warning makes that record a lie, and a
verified stamp nobody earned is worse than no stamp at all.

If a finding turns out to be wrong, the useful move is usually to stash the
correction (which appends a dated update to the same slug) and then `verify`,
rather than to archive and lose the history of what was believed and why.

## Reply

One line per item: the handle, what you checked, and the outcome. If nothing
needed review, say so in one line.
