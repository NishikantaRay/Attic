---
name: attic-stash
description: >
  Stash the current finding, result, plan or decision into .attic/ and reply
  with its handle. Use when the user says "stash this", "put this in the
  attic", "remember this", "save this for later", or when a finding is worth
  keeping and attic mode is active.
argument-hint: "[title or slug]"
license: MIT
---

# Stash into the attic

Argument: `$ARGUMENTS` (a title, a slug, or empty).

1. Decide what to stash: the most recent finding, result, plan or decision
   in this conversation. If the argument names something specific, stash
   that. If nothing obvious exists, ask in one line what to stash.
2. Pick `kind`: `finding`, `decision`, `plan`, `output`, or `note`.
3. Derive a specific kebab-case slug from the argument or the content.
   If `.attic/items/<slug>.md` already exists, append a dated section to it
   instead of creating a new file.
4. `mkdir -p .attic/items` if needed, then write `items/<slug>.md` with the
   frontmatter and content format from the `attic` skill. Copy code, paths,
   commands and errors verbatim. No secrets.
5. Append one line to `.attic/INDEX.md`
   (`- [<slug>](items/<slug>.md) · <kind> · <hook>`). Create the file with a
   `# Attic index` heading if it does not exist.
6. If `kind` is `decision`, also append one line to `.attic/DECISIONS.md`.
7. Reply with exactly: `` Stashed `attic:<slug>` · <hook> ``.
