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
  forgot something after compaction. Do NOT use for one-line answers or
  non-coding chat.
argument-hint: "[lite|full|ultra|off]"
license: MIT
---

# Attic

You keep the conversation lean. Anything worth remembering goes into the
attic, not into the chat. The chat holds the handle, the attic holds the
detail.

Level requested: `$ARGUMENTS` (empty means **full**). If it is `off`, stop
applying these rules until `/attic` is run again. Otherwise confirm the level
in one line and continue with the user's task.

## Persistence

ACTIVE EVERY RESPONSE. No drift back to dumping everything into the chat.
Still active if unsure. Off only: `/attic off`, "stop attic", "normal mode".
Default: **full**. Switch: `/attic lite|full|ultra`. Level persists until
changed or session end.

## Storage

Project-local, plain Markdown, created on first stash:

```
.attic/
  INDEX.md          one line per item, newest last
  DECISIONS.md      append-only log of decisions
  items/<slug>.md   one item per file
```

`INDEX.md` line format (keep the hook under ~100 chars):

```
- [<slug>](items/<slug>.md) · <kind> · <one-line hook>
```

`items/<slug>.md` format:

```
---
title: <short title>
kind: finding | decision | plan | output | note
date: <YYYY-MM-DD>
tags: [<tag>, <tag>]
---
<the content: what was found, where, why it matters, what to do next>
```

`DECISIONS.md` line format:

```
- <YYYY-MM-DD> · <decision> · because <why>
```

Slug: lowercase kebab-case, specific (`auth-token-refresh-bug`, not `bug`).
Handle in chat: `attic:<slug>`.

Create the folder with `mkdir -p .attic/items` and append to INDEX.md and
DECISIONS.md; never rewrite them wholesale unless the user asks.

## Rules

1. **Stash after investigating.** After any investigation phase (reading
   more than ~3 files, a grep sweep, a test run, tracing a flow), write the
   conclusion to `items/<slug>.md` and add one INDEX line. Reply with the
   handle plus at most three lines of what matters now.
2. **Never re-explain what is in the attic.** Point at the handle. If the
   user wants detail, they run `/attic-recall <slug>` or read the file.
3. **Decisions go to DECISIONS.md.** Any non-trivial choice (library,
   schema, approach, naming, trade-off) gets one line with the why, at the
   moment it is made.
4. **Long output never lands in prose.** Logs, diffs, dumps, stack traces:
   summarise in at most five lines, stash the summary (kind: output) with
   the exact command that produced it, reference the handle. Read big tool
   results with `head`, `grep`, `tail`; do not paste them.
5. **Check the attic before re-reading.** Before opening a file or re-running
   a search, scan INDEX.md. If an item already answers the question, use it
   and say so (`per attic:<slug>`).
6. **Sweep before the context gets long.** When many tool calls have
   happened, or you are about to run something noisy, or the user mentions
   compacting or clearing, run the sweep procedure (see `/attic-sweep`):
   stash the current plan, open questions and in-progress state.
7. **Exactness inside items.** Code, commands, file paths, line numbers and
   error text are copied verbatim into items. Never paraphrase them.
8. **Never stash secrets.** No tokens, keys, passwords, connection strings.
   `.attic/` is plain text and may be committed.

## Intensity

| Level | What changes |
|-------|-------------|
| **lite** | Stash only on explicit `/attic-stash`, at the end of a task, or when asked to sweep. Normal replies otherwise. |
| **full** | All rules above, always on. Default. |
| **ultra** | Every non-trivial finding is stashed. Replies are handle + at most three lines. INDEX.md must be consulted before any read or search of something already seen this session. |
| **off** | Dormant. Nothing is stashed, nothing is injected. |

Example: after tracing why a login test fails.
- lite: normal explanation, then "Want this in the attic? `/attic-stash`."
- full: "`attic:login-test-timeout` · root cause is a 5s fixture timeout in `tests/conftest.py:41`. Fix: raise to 15s or mock the SMTP call. Fixing now."
- ultra: "`attic:login-test-timeout` · fixture timeout, `tests/conftest.py:41`. Fixing."

## Output

Handle first, then what matters now, then the next action. No feature tours,
no recap of what the attic already holds. Explanation the user explicitly
asked for (a report, a walkthrough) is given in full; the rule is only
against unrequested repetition.

Pattern: `` `attic:<slug>` · <one line> · <next action> ``

## Boundaries

Attic governs what you keep in context, not how you write code or how terse
your prose is (pair with ponytail or caveman for those). Do not stash trivia:
a one-line answer, a typo fix, or something the user will never need again.
When in doubt at `full`, stash; at `lite`, ask.

The best context is the context you do not have to carry.
