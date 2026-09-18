---
name: attic-stash
description: >
  Stash the current finding, result, plan or decision into .attic/ and reply
  with its handle. Use when the user says "stash this", "put this in the
  attic", "remember this", "save this for later", or when a finding is worth
  keeping and attic mode is active.
argument-hint: "[title or slug]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" *) Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js"*)
version: 1.6.0
license: MIT
---

# Stash into the attic

Argument: `$ARGUMENTS` (a title, a slug, or empty).

1. Decide what to stash: the most recent finding, result, plan or decision in
   this conversation. If the argument names something specific, stash that.
   If nothing obvious exists, ask in one line what to stash.
   Unsure whether it is worth keeping? Read
   `${CLAUDE_SKILL_DIR}/../attic/references/what-to-stash.md`.
2. Pick a `kind` (`finding`, `decision`, `plan`, `output`, `note`) and a
   specific kebab-case slug that will still make sense in a month.
3. Record the evidence (see **Provenance** below): which files the conclusion
   came from, which commands produced it, and how far you actually checked it.
4. Write the body to a temp file, then call the script. It handles the
   folder, frontmatter, index line, atomic write, and secret scan:

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" stash \
  --slug <slug> --kind <kind> --title "<title>" \
  --hook "<one line under 100 chars>" [--tags a,b] \
  [--type <type>] [--confidence verified|unverified] \
  [--files "src/a.ts,src/b.ts"] [--commands "rg foo src"] \
  [--decision-why "<why>"] --body-file <tmpfile>
```

   An existing slug appends a dated update instead of overwriting.

5. Exit code 2 means a credential was detected and nothing was written.
   Redact the value, keep the location, retry. Never pass `--force`.
6. If the script cannot run at all (no Node, or the call is denied), fall
   back to writing the files yourself following
   `${CLAUDE_SKILL_DIR}/../attic/references/item-format.md`, and say in one
   line that the secret scan and atomic write were skipped. Never silently
   substitute hand-written files for the script.
7. Reply with exactly: `` Stashed `attic:<slug>` · <hook> ``.

## Provenance

These flags are what make a finding re-checkable later. They are optional and
the stash works without them, but a finding with no evidence cannot be told
apart from a guess six sessions from now.

| Flag | Pass when |
|---|---|
| `--files` | You read those files to reach the conclusion. Repo-relative. This is what freshness watches: if none are named, nothing can be checked. |
| `--commands` | A command produced the evidence (`rg ...`, `npm test`). Lines containing a credential are dropped automatically. |
| `--confidence verified` | **Only** when you actually checked the claim against the code in this session. |
| `--type` | The item is a `failed-approach` or a `workaround`. Otherwise it follows `kind`. |

`--confidence` defaults to `unverified`, and that default is usually right.
Saving a finding is not the same as confirming it. Claim `verified` only for
something you read and checked; a plausible inference, a remembered detail, or
anything a user told you is `unverified`. Over-claiming here is worse than
saying nothing, because it disables the warning a later session would get.

Naming files you did not actually look at is the same error in a different
place: it makes freshness watch the wrong thing.
