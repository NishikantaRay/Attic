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
| `/attic-prune` | Find items that are merely OLD and archive them. **Dry run by default**; needs `--apply`, and never deletes |
| `/attic-fail` | Record an approach that was tried and did not work, with the reason. Also used for temporary workarounds |

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
| `/attic-review` | Check which items may no longer match the code, and resolve them with `verify` or `archive` |
| `/attic-git` | Fix `.attic/` merge conflicts and set up a shared team attic |

`prune`, `doctor` and `review` answer three different questions: prune asks
what is **old**, doctor asks what is **structurally broken**, and review asks
what may no longer be **true**.

## The script underneath

Skills call `skills/attic/scripts/attic.js`. You can run it directly; it is
the same code the model uses.

```sh
node skills/attic/scripts/attic.js <command> [options]
```

| Command | Options |
|---|---|
| `init` | create `.attic/` |
| `stash` | `--slug` `--kind` `--title` `--hook` `--tags a,b` `--body` \| `--body-file` `--decision-why` `--type` `--confidence` `--files` `--commands` `--source-url` |
| `edit` | `--slug` `--title` `--kind` `--hook` `--tags a,b` `--body` \| `--body-file` — **replaces** the item, where `stash` on an existing slug appends |
| `recall <words>` | `--no-freshness` to skip the git check |
| `index` | `--limit N` |
| `pin <slug>` | `--unpin` |
| `archive <slug>` | `--restore` |
| `prune` | `--older-than 90d` `--kind output` `--apply` |
| `review` | `--limit N` `--all` — list items whose evidence moved. Read-only |
| `verify <slug>` | `--stale` `--confidence c` `--files a,b` `--note t` — record that someone checked it |
| `rebuild` | `--dry-run` — regenerate `INDEX.md` from the item files |
| `validate` | — |

Global: `--json` for machine-readable output, `--cwd <dir>` to target another
project.

`--kind` is one of `finding`, `decision`, `plan`, `output`, `note`.

## Trust metadata (1.6)

All optional. An item written without them still works; it simply reports its
provenance as unknown rather than as verified.

| Flag | Values | Default |
|---|---|---|
| `--type` | `finding` `decision` `note` `failed-approach` `workaround` | follows `--kind` |
| `--confidence` | `unknown` `unverified` `verified` | `unverified` |
| `--files` | comma-separated, stored repo-relative | none |
| `--commands` | newline-separated; lines with a credential are dropped | none |
| `--source-url` | one `http(s)` URL | none |

`--type` is a separate field from `--kind` on purpose: the `INDEX.md` line
format matches `kind` as `[a-z]+`, so a hyphenated value there would be
unreadable to any older copy of the script.

Freshness statuses reported by `recall` and `review`:

| Status | Meaning |
|---|---|
| `current` | Nothing the item cites has changed. |
| `possibly-stale` | A cited file changed since the item was recorded. **Check it**, do not assume it is wrong. |
| `needs-review` | A cited file is gone, the item is a workaround, or it was flagged. |
| `unknown` | No provenance, or not a git repository. |

Freshness runs only on `recall` (one item) and `review` (all items). Nothing
on the session-start path shells out to git.

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
