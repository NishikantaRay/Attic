Attic remembers what you found. Now it also tells you when that memory may have gone out of date.

A finding stashed six weeks ago reads exactly like one stashed this morning. Both are confident, both are specific, and one of them may describe a file that has since been rewritten. Until now Attic had no way to tell you which — and an agent handed a stale finding will act on it with the same conviction as a fresh one. That is the failure this release is about.

## Findings now carry their evidence

A stash can record where its knowledge came from: the files it was read from, the commands that produced it, the commit it was recorded at, and how far it was actually checked.

```yaml
type: finding
confidence: verified
revision: a1b2c3d
files: [src/middleware/auth.ts, src/routes/index.ts]
commands: [rg "authMiddleware" src]
```

Nothing here is invented. A value that cannot be determined is left off rather than guessed, because an absent field reads as unknown while a fabricated one reads as evidence. `confidence` defaults to `unverified` and stays there unless something explicitly claims otherwise — saving a finding is not the same as checking it, and an agent that stashes a plausible inference should not be able to launder it into a fact by writing it down.

## Recall tells you whether to trust it

```
[auth-order] Auth middleware runs after route registration
finding · verified · possibly-stale
revision: a1b2c3d (now e4f5g6h)
evidence: src/middleware/auth.ts

⚠ Possibly stale
referenced file(s) changed since a1b2c3d: src/middleware/auth.ts
Verify against the current working tree before reuse.
```

A current item spends one line on trust. The warning block is spent only where there is something to act on, because recall output goes into a model's context and a warning that is always on is a warning nobody reads.

## What "possibly stale" does not mean

It means **a file underneath this finding changed**. It does not mean the finding is wrong, and Attic never decides that it is.

That distinction is the whole design. A repository that has merely moved on is not evidence about a finding whose own files nobody touched, so an unrelated commit does not mark anything stale. And the signal has honest limits worth stating: a finding can be wrong the day it is written and still report `current`; a cited file can be reformatted and report `possibly-stale` though nothing meaningful changed. Freshness tracks whether the ground moved, not whether the conclusion survived. Only someone who reads the code can make that call.

Which is why `review` is read-only and `verify` is a separate, deliberate act. A command that both detected staleness and resolved it would be rewriting your memory on a heuristic.

## Reviewing, and recording what did not work

`/attic-review` lists what may no longer match the code, worst first. `verify` records that you looked and it still holds; `verify --stale` records the opposite. Neither touches the item's prose — a finding that turned out to be wrong keeps its text, because knowing what was once believed, and why, is usually the useful part.

`/attic-fail` records an approach that was tried and failed, with the reason. The next session will consider the same idea for the same reasons, and the record of why it did not work is what stops the second attempt from costing what the first one did. `--type workaround` marks a temporary fix, and workarounds always surface in review — one that quietly becomes permanent is its own kind of failure.

## Two fixes worth naming

**`git status --porcelain` output must not be trimmed.** An unstaged edit is reported as `" M path"`, with a leading space. Trimming that shifted every record one character left, so a changed `src/auth.js` was reported to the user as `rc/auth.js`. Paths are now read with `-z`, which also keeps paths containing spaces intact instead of backslash-escaped.

**Absolute paths could survive into frontmatter.** On macOS a temp directory is handed out as `/var/...` while git reports the resolved `/private/var/...`, so the relative-path conversion fell through to its fallback and stored the absolute path — naming the developer's home directory in a file teams commit, and breaking on clone. Both sides now resolve through `realpath` first. Any symlinked checkout hit the same path.

## Upgrading

Nothing to do. The format is additive, every new field is optional, and the `INDEX.md` line is byte-identical — trust metadata lives in the item, not in the index that gets injected, so your per-session context cost is unchanged.

Items stashed before 1.6 have no provenance. They recall exactly as they did, report freshness as `unknown`, and are left out of `review` by default: listing your entire existing attic as suspect on first upgrade would make the command useless. `review --all` includes them.

New findings gain provenance as you stash them. There is no migration, and no reason to rebuild anything.

---

The browser library becomes something you can read and write in, not just search.

1.4.0 shipped a Chrome extension that could clip a page and list what was already stashed. The listing part was thin: items were shown as raw monospace text, and everything else — editing, organising, following a thread between two findings — still meant opening the files. This release closes that.

## Items read like documents

Bodies render as markdown: headings, tables, task lists, fenced code with its language. Long items get an outline. The renderer is hand-rolled, because MV3's content security policy blocks loading a parser from a CDN, and it escapes every string before adding any structure — item bodies contain clipped web pages, so a body carrying `<img onerror=...>` is not hypothetical. A `javascript:` link is dropped rather than rendered.

## Items link to each other

Write `[[another-slug]]` in a body and it becomes a link; `attic:some-slug` handles work too. Each item shows what it links to **and what links back to it**, computed from the bodies rather than stored, so adding a link appears under its target immediately. A link to a slug you have not written yet shows as dangling instead of a dead click.

That is the difference between a folder of notes and something you can actually navigate.

## You can write, not just read

Editing an item in place, pinning it, archiving it. Saving **replaces** the body — which is a genuinely different operation from stashing, because `attic stash` on an existing slug appends a dated `## Update` section. That is right for an agent adding to a finding and wrong for a person fixing a typo in one, so editing got its own path (`attic.js edit`, and `PUT /item` behind it). The secret scan runs on an edit exactly as it runs on a stash; otherwise "edit" would be the way around the check.

There is deliberately **no delete**. Archiving is a rename into `.attic/archive/` and restore reverses it, so nothing you do from a browser is unrecoverable. That is the argument that makes browser-side writing defensible at all.

## Finding things

A command palette on `⌘K`, search across full bodies with the match highlighted in context, filtering by kind or tag, and views for decisions, the link graph, and attic health. Keyboard throughout: `/` search, `j`/`k`/`Enter`, `e` edit, `c` clip, `?` for the rest.

## One fix worth naming

**Clip tab opened a completely blank form.** The code asked for the active tab — but the library is itself a tab, so the active tab *was* the library, and the next line filtered it out for being an extension page. The query and the filter contradicted each other, so nothing was ever found. Clipping now reads the most recently used ordinary page in the window, which is the page you were looking at before you opened the library.

## Upgrading

**Restart the companion.** A Node process does not reload its source, so one left running from 1.4.0 keeps serving the old routes and the library will come up empty:

```
npm run attic:serve -- --root /path/to/project
```

Then reload the extension at `chrome://extensions`.

---

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

```
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

No network calls, no telemetry, no API keys. The optional browser companion is bound to loopback, token-authenticated, and limited to the project roots you name.
