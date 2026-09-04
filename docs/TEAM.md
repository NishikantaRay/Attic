# Sharing an attic across a team

A committed `.attic/` turns individual findings into shared memory. A new
contributor's first session starts with the index already in context.

## What to commit

| Path | Commit? | Why |
|---|---|---|
| `.attic/INDEX.md` | Yes | The shared index, injected at every session start. |
| `.attic/items/*.md` | Yes | The knowledge itself. |
| `.attic/DECISIONS.md` | Yes | Why the project is the way it is. |
| `.attic/items/session-*.md` | Usually not | Personal working state. Add to `.gitignore` if it creates noise. |
| `.attic/archive/` | Your call | Keeps history recallable at the cost of repository size. |

For a personal attic instead, add `.attic/` to `.gitignore` and stop here.

## The merge problem, and the fix

`INDEX.md` and `DECISIONS.md` are append-only. Two branches that each stash
something both add a line at the end, which git treats as a conflict. On an
active team this happens constantly.

Run `/attic-git`, or set it up manually:

`.gitattributes` (committed):

```
.attic/INDEX.md merge=attic
.attic/DECISIONS.md merge=attic
```

Per clone, once (git will not let a repository set a driver command itself):

```bash
git config merge.attic.name "attic union merge"
git config merge.attic.driver "node <plugin>/scripts/attic-merge.js %O %A %B %P"
```

The driver keeps both sides, deduplicates by slug for the index and by whole
line for decisions, and preserves order. Item files rarely conflict, because
each item is its own file, and are left to normal merge behaviour.

Without the driver, a conflict resolved by taking one side silently discards
the other side's findings. That is the failure worth avoiding.

## Credentials in a shared attic

`scripts/attic.js` refuses to write a detected credential. If one reaches the
attic anyway, and the attic is committed:

1. **Rotate the credential.** It is in git history on every clone and every
   fork. Deleting the file does not unpublish it.
2. Remove the value from the item, keeping the location and the fact.
3. Run `/attic-doctor` to confirm nothing else is flagged.

Treat a committed attic with the same care as any other committed file.

## Onboarding

Someone cloning a repository with an attic gets the index injected at their
first session start. Point them at `/attic-index` for the full list and
`/attic-recall <topic>` for anything collapsed past the injection budget.

## Conventions worth agreeing on

- **Slugs are durable**: name the thing, not the ticket.
- **Pin sparingly.** The pinned tier is small and shared; every pin costs
  everyone context on every session.
- **Prune together.** `/attic-prune` archives rather than deletes, but a
  shared attic should not be reorganised unilaterally.
