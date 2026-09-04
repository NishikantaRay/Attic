---
name: attic-sweep
description: >
  Save the state of the current session into the attic before context is
  lost: the current plan, open questions, in-progress work, and any finding
  not yet stashed. Use right before /compact or /clear, at the end of a
  session, or when the user says "save state", "wrap up", "before compact",
  "checkpoint", or "context is getting long".
license: MIT
---

# Sweep the session into the attic

Goal: after this runs, a fresh session that reads only `.attic/INDEX.md`
could continue the work.

1. Review the conversation so far and collect anything not yet in the attic:
   - findings from investigation (root causes, how a flow works, where things live)
   - decisions made and why
   - the current plan and which steps are done
   - open questions and things the user still has to decide
   - in-progress state: files being edited, tests failing, commands to rerun
2. Stash findings and decisions as separate items (follow `/attic-stash`).
   Skip anything already covered by an existing item; append to it instead
   if there is genuinely new detail.
3. Write or update one item `items/session-<YYYY-MM-DD>.md` with
   `kind: plan` holding the plan, open questions and in-progress state.
   If it exists from earlier today, replace its content with the current
   state.
4. Append INDEX.md lines for every new item, and DECISIONS.md lines for
   every new decision.
5. Reply with the list of handles written, one per line, then a single line:
   "Safe to /compact."

Copy commands, paths and errors verbatim. No secrets.
