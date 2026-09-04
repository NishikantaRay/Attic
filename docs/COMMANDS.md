# Command reference

Every command, what it does, and when it fires on its own.

On Claude Code commands are `/attic-x`; if another plugin claims a name, use
the namespaced form `/attic:attic-x`. On Codex they are `$attic-x`.

## Levels

| Command | Effect |
|---|---|
| `/attic` | Set level `full` (the default) and report it |
| `/attic lite` | Stash only when asked, at the end of a task, or on a sweep |
| `/attic full` | Stash after every investigation; reply with handle + ≤3 lines |
| `/attic ultra` | Stash everything non-trivial; consult the index before any re-read |
| `/attic off` | Dormant: nothing stashed, nothing injected |
| `/attic default <level>` | Make a level the default for **new** sessions |

"stop attic" and "normal mode" also switch it off. The level persists until
changed or the session ends. `ATTIC_DEFAULT_MODE=lite|full|ultra|off` sets
the starting level for a session.

| Level | Stashes | Reply style | Use when |
|---|---|---|---|
| `lite` | on request only | normal prose | you want control, or short tasks |
| `full` | after each investigation | handle + ≤3 lines | day-to-day work. Default |
| `ultra` | everything non-trivial | handle + ≤3 lines, must check index first | long sessions, big codebases |
| `off` | never | normal prose | one-off questions; the honest A/B baseline |

## Writing

| Command | What it does |
|---|---|
| `/attic-stash [title]` | Stash the latest finding, result, plan or decision. Replies with the handle. Reusing a slug appends a dated update rather than overwriting |
| `/attic-sweep` | Save the whole session: plan, open questions, in-progress state, plus anything not yet stashed. Ends with "Safe to /compact." |
| `/attic-pin <slug>` | Always inject this item; never trim it. `--unpin` reverses |
| `/attic-prune` | Find stale items and archive them. **Dry run by default**; needs `--apply`, and never deletes |

Fires on its own (at `full`/`ultra`): "stash this", "remember this", "save
this for later", "before compact", "context is getting long", "where are we",
"summarise what we've done".

## Reading

| Command | What it does |
|---|---|
| `/attic-index` | List everything stashed in this project, plus recent decisions |
| `/attic-recall <slug or words>` | Pull one item back and summarise it in ≤10 lines |
| `/attic-stats` | What the attic costs and holds, measured from local transcripts |
| `/attic-help` | One-screen reference card |

`recall` answers a question about a **topic**; `index` answers "what is in
there at all". Archived items stay recallable.

## Maintenance

| Command | What it does |
|---|---|
| `/attic-doctor` | Check `.attic/` for drift: orphans, stale index lines, malformed frontmatter, leaked credentials |
| `/attic-git` | Fix `.attic/` merge conflicts and set up a shared team attic |

## The script underneath

Skills call `skills/attic/scripts/attic.js`. You can run it directly; it is
the same code the model uses.

```sh
node skills/attic/scripts/attic.js <command> [options]
```

| Command | Options |
|---|---|
| `init` | create `.attic/` |
| `stash` | `--slug` `--kind` `--title` `--hook` `--tags a,b` `--body` \| `--body-file` `--decision-why` |
| `recall <words>` | — |
| `index` | `--limit N` |
| `pin <slug>` | `--unpin` |
| `archive <slug>` | `--restore` |
| `prune` | `--older-than 90d` `--kind output` `--apply` |
| `rebuild` | `--dry-run` — regenerate `INDEX.md` from the item files |
| `validate` | — |

Global: `--json` for machine-readable output, `--cwd <dir>` to target another
project.

`--kind` is one of `finding`, `decision`, `plan`, `output`, `note`.

**Exit codes.** `0` ok · `1` usage or not found · `2` refused, a credential
was detected · `3` validation failed.

The script refuses to write a detected credential. Do not pass `--force` to
get around it; redact the value and keep the location.

## Repair

`INDEX.md` is derived data. The item files are the source of truth, so a
corrupted or hand-edited index is always recoverable:

```sh
node skills/attic/scripts/attic.js rebuild --dry-run   # see what would change
node skills/attic/scripts/attic.js rebuild             # apply
```

## Developer commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests: script, hooks, merge driver, Codex port |
| `npm run bench` | The two-arm token benchmark |
| `npm run build:codex` | Regenerate `codex/` after changing a skill |
| `npm run make:assets` | Regenerate the README diagrams |
| `npm run bump -- <version>` | Move every version string together |
| `sh scripts/try-attic.sh` | The side-by-side demo |
| `node scripts/run-evals.js --suite activation` | Does the right skill fire? |
| `node scripts/run-behavior.js` | Does the skill then do its job? |
