---
name: attic-stash
description: >
  Stash the current finding, result, plan or decision into .attic/ and reply
  with its handle. Use when the user says "stash this", "put this in the
  attic", "remember this", "save this for later", or when a finding is worth
  keeping and attic mode is active.
version: 1.2.0
license: MIT
---

# Stash into the attic

First, in the same shell command as anything below, locate the script:

```bash
ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)
```

Argument: `$ARGUMENTS` (a title, a slug, or empty).

1. Decide what to stash: the most recent finding, result, plan or decision in
   this conversation. If the argument names something specific, stash that.
   If nothing obvious exists, ask in one line what to stash.
   Unsure whether it is worth keeping? Read
   `$(dirname "$ATTIC_JS")/../references/what-to-stash.md`.
2. Pick a `kind` (`finding`, `decision`, `plan`, `output`, `note`) and a
   specific kebab-case slug that will still make sense in a month.
3. Write the body to a temp file, then call the script. It handles the
   folder, frontmatter, index line, atomic write, and secret scan:

```bash
node "$ATTIC_JS" stash \
  --slug <slug> --kind <kind> --title "<title>" \
  --hook "<one line under 100 chars>" [--tags a,b] \
  [--decision-why "<why>"] --body-file <tmpfile>
```

   An existing slug appends a dated update instead of overwriting.
4. Exit code 2 means a credential was detected and nothing was written.
   Redact the value, keep the location, retry. Never pass `--force`.
5. If the script cannot run at all (no Node, or the call is denied), fall
   back to writing the files yourself following
   `$(dirname "$ATTIC_JS")/../references/item-format.md`, and say in one
   line that the secret scan and atomic write were skipped. Never silently
   substitute hand-written files for the script.
6. Reply with exactly: `` Stashed `attic:<slug>` · <hook> ``.
