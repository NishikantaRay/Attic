---
name: attic
description: >
  Offloads context. Stashes findings, decisions, plans and long tool outputs
  into a project-local .attic/ folder and keeps only a one-line index in the
  conversation, so the live context stays lean and important knowledge
  survives /compact, /clear and new sessions. Supports intensity levels:
  lite, full (default), ultra, off. Use on ANY multi-step task that involves
  investigating a codebase, reading many files, running noisy commands, or
  making design decisions. Also use whenever the user says "attic", "stash
  this", "remember this", "save this for later", "put it in the attic",
  "context is getting long", "before compact", or complains that Claude
  forgot something after compaction. Do NOT use for one-line answers, typo
  fixes, or non-coding chat.
version: 1.1.0
license: MIT
---

# Attic

You keep the conversation lean. Anything worth remembering goes into the
attic, not into the chat. The chat holds the handle, the attic holds the
detail.

Level requested: `$ARGUMENTS` (empty means **full**). If it is `off`, stop
applying these rules until `/attic` is run again. Otherwise confirm the level
in one line and continue with the user's task.

## Scope

Attic governs **what you keep in context**. It does not govern how terse your
prose is, or how much code you write. Do not use it for one-line answers,
typo fixes, or anything the user will never need again.

## Persistence

ACTIVE EVERY RESPONSE. No drift back to dumping everything into the chat.
Still active if unsure. Off only: `/attic off`, "stop attic", "normal mode".
Default: **full**. Switch: `/attic lite|full|ultra`. Level persists until
changed or session end.

## Use the script, not your own bookkeeping

`$(attic --skills-dir)/attic/scripts/attic.js` owns every mechanical part: slug
hygiene, frontmatter, INDEX and DECISIONS bookkeeping, atomic writes, and
secret detection. Call it. Do not hand-write these files when the script is
available.

```bash
attic stash \
  --slug login-test-timeout --kind finding \
  --title "Login test times out" \
  --hook "5s fixture timeout in tests/conftest.py:41, SMTP call is real" \
  --tags tests,flaky \
  --body-file /tmp/body.md

attic recall "login timeout"
attic index
attic validate
```

`--kind` is one of `finding`, `decision`, `plan`, `output`, `note`. Add
`--decision-why "<reason>"` to also log a line in `DECISIONS.md`. Long bodies
go through `--body-file`. Exit code 2 means the script refused because it
detected a credential: redact and retry, never pass `--force` to smuggle a
secret past it.

Your judgement decides *what* is worth stashing and writes the prose. The
script decides *how* it lands on disk.

## Rules

1. **Stash after investigating.** After any investigation (reading more than
   ~3 files, a grep sweep, a test run, tracing a flow), stash the conclusion
   and reply with the handle plus at most three lines of what matters now.
2. **Never re-explain what is in the attic.** Point at the handle. If the
   user wants detail, they run `/attic-recall <slug>`.
3. **Long output never lands in prose.** Logs, diffs, dumps, stack traces:
   summarise in at most five lines, stash as `kind: output` with the exact
   command, reference the handle. Read big results with `head`, `grep`,
   `tail`; do not paste them.
4. **Check the attic before re-reading.** `.attic/INDEX.md` is normally
   already in your context from session start. Scan it before opening a file
   or re-running a search. If an item answers the question, say so
   (`per attic:<slug>`).

   If no index appears in your context and a `.attic/` exists in the
   project, the session-start injection did not run. Read the index once
   yourself and carry on. Do not conclude the attic is empty because
   nothing was injected.
5. **Decisions get logged** with their why, at the moment they are made.
6. **Sweep before the context gets long**, before `/compact` or `/clear`, and
   at the end of a work session. See `/attic-sweep`.
7. **Exactness inside items.** Code, commands, paths, line numbers and error
   text are copied verbatim. Never paraphrase them.
8. **Never stash secrets.** The script enforces this; do not work around it.

## Intensity

| Level | What changes |
|-------|-------------|
| **lite** | Stash only on explicit `/attic-stash`, at the end of a task, or when asked to sweep. Normal replies otherwise. |
| **full** | All rules above, always on. Default. |
| **ultra** | Every non-trivial finding is stashed. Replies are handle + at most three lines. INDEX.md must be consulted before any read or search of something already seen this session. |
| **off** | Dormant. Nothing is stashed. |

Example: after tracing why a login test fails.
- lite: normal explanation, then "Want this in the attic? `/attic-stash`."
- full: "`attic:login-test-timeout` · 5s fixture timeout at `tests/conftest.py:41`, the SMTP call is real. Raising it to 15s."
- ultra: "`attic:login-test-timeout` · fixture timeout, `tests/conftest.py:41`. Fixing."

## Output

Handle first, then what matters now, then the next action. No feature tours,
no recap of what the attic already holds. Explanation the user explicitly
asked for is given in full; the rule is only against unrequested repetition.

Pattern: `` `attic:<slug>` · <one line> · <next action> ``

## References

Load only when needed:

- `references/what-to-stash.md` — the stash/skip/never call when it is unclear.
- `references/item-format.md` — the on-disk format, for hand-editing without the script.
- `references/workflow.md` — the loop and sweep pipelines, and the boundary with sibling skills.
- `templates/item.md`, `templates/session.md` — starting shapes.

The best context is the context you do not have to carry.
