# Attic workflows

The skill combines two shapes: a **loop** during work, and a **pipeline**
when sweeping.

## Loop: during a task

```
work → did something non-trivial become known?
         no  → keep working
         yes → already in the index?
                 yes → append to that item, cite the handle
                 no  → stash it, reply with handle + <=3 lines
       → continue
```

The check "already in the index" runs against `.attic/INDEX.md`, which is
already in context from session start. It costs nothing to check and prevents
duplicate items.

## Pipeline: sweeping before context is lost

```
collect  → findings, decisions, plan, open questions, in-progress state
dedupe   → drop anything already stashed; append where there is new detail
write    → one item per finding/decision, one session-<date>.md for state
verify   → scripts/attic.js validate
report   → handles written, then "Safe to /compact."
```

Trigger the pipeline on: `/attic-sweep`, the user mentioning compaction or
clearing, the end of a work session, or your own judgement that the context
is long.

## Route: which skill handles what

```
"stash this"                    → attic-stash
"what did we find about X"      → attic-recall
"what's in the attic"           → attic-index
"save state" / "before compact" → attic-sweep
"attic lite|full|ultra|off"     → attic
everything else, while active   → the rules in SKILL.md, no skill invocation
```

## Boundary with sibling skills

Attic governs **what you keep in context**. It does not govern how terse your
prose is, or how much code you write. Those are separate concerns, and skills
that govern them compose cleanly with this one: at `ultra`, alongside a skill
that enforces terse prose, a reply is a handle and a fragment.
